import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Project, SyntaxKind, Node, FileReference } from "ts-morph";
import * as fs from "fs";

const server = new McpServer({ name: "react-ast", version: "1.0.0" });

const project = new Project({ compilerOptions: { jsx: 1 } });

interface Component {
  name: string;
  isMemoized: boolean;
  propsType?: string | undefined;
}

interface ComponentsResponse {
  components: Component[];
}

interface Warning {
  parentComponent: string;
  propName: string;
  issue: string;
  suggestion: string;
  line: number;
}

interface WarningsResponse {
  warnings: Warning[];
}

server.registerTool(
  "ping",
  {
    description: "Check if the server is running"
  },
  async () => {
    return {
      content: [
        {
          type: "text",
          text: "Server is running"
        }
      ]
    };
  }
);

server.registerTool(
  "analyze_component",
  {
    description:
      "Analyzes React component and returns its AST structure (names, props and memoization status)",
    inputSchema: {
      fileName: z.string().describe("Absolute path to the .tsx component file")
    }
  },
  async ({ fileName }) => {
    if (!fs.existsSync(fileName)) {
      return {
        content: [
          {
            type: "text",
            text: "File not found"
          }
        ]
      };
    }
    try {
      const sourceFile = project.addSourceFileAtPath(fileName);
      const result: ComponentsResponse = { components: [] };

      const varDecls = sourceFile.getDescendantsOfKind(
        SyntaxKind.VariableDeclaration
      );
      for (const decl of varDecls) {
        let isMemoized = false;
        let componentFunctionNode: Node | undefined = undefined;
        const init = decl.getInitializer();

        if (!init) continue;

        if (Node.isCallExpression(init)) {
          const expression = init.getExpression();
          const expressionText = expression.getText();

          if (expressionText === "memo" || expressionText === "React.memo") {
            isMemoized = true;
            const args = init.getArguments();
            if (args.length > 0 && Node.isArrowFunction(args[0])) {
              componentFunctionNode = args[0];
            }
          }
        } else if (Node.isArrowFunction(init)) {
          componentFunctionNode = init;
        }

        if (
          componentFunctionNode &&
          Node.isArrowFunction(componentFunctionNode)
        ) {
          const name = decl.getName();

          if (/^[A-Z]/.test(name)) {
            const compInfo: Component = {
              name,
              isMemoized
            };

            const params = componentFunctionNode.getParameters();
            if (params.length > 0) {
              compInfo.propsType = params[0]?.getType().getText(decl);
            }
            result.components.push(compInfo);
          }
        }
      }

      project.removeSourceFile(sourceFile);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Parsing error: ${error.message}` }]
      };
    }
  }
);

server.registerTool(
  "detect_unstable_props",
  {
    description:
      "Analyzes JSX in a file to find inline objects or inline functions passed as props, which break React.memo reconciliation.",
    inputSchema: {
      filePath: z.string().describe("Absolute path to component's file")
    }
  },
  async ({ filePath }) => {
    if (!fs.existsSync(filePath)) {
      return {
        content: [
          {
            type: "text",
            text: "File not found"
          }
        ]
      };
    }

    try {
      const sourceFile = project.addSourceFileAtPath(filePath);
      const result: WarningsResponse = { warnings: [] };

      const jsxElements = [
        ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
        ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement)
      ];

      for (const element of jsxElements) {
        const componentName = element.getTagNameNode().getText();
        if (!/^[A-Z]/.test(componentName)) continue;

        const attributes = element.getAttributes();
        for (const attribute of attributes) {
          if (Node.isJsxAttribute(attribute)) {
            const propName = attribute.getNameNode().getText();
            const initializer = attribute.getInitializer();

            if (initializer && Node.isJsxExpression(initializer)) {
              const expression = initializer.getExpression();
              if (!expression) continue;

              let issueType = null;
              if (Node.isObjectLiteralExpression(expression)) {
                issueType = "Inline Object";
              } else if (Node.isArrayLiteralExpression(expression)) {
                issueType = "Inline Array";
              } else if (
                Node.isFunctionExpression(expression) ||
                Node.isArrowFunction(expression)
              ) {
                issueType = "Inline Function";
              }

              if (issueType) {
                result.warnings.push({
                  parentComponent: componentName,
                  propName: propName,
                  issue: issueType,
                  suggestion:
                    issueType === "Inline Function"
                      ? "Wrap in useCallback"
                      : "Wrap in useMemo",
                  line: attribute.getStartLineNumber()
                });
              }
            }
          }
        }
      }

      project.removeSourceFile(sourceFile);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `Parsing error: ${error.message}`
          }
        ]
      };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("React-AST MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main(): ", error);
  process.exit(1);
});
