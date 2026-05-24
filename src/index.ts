import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Project, SyntaxKind, Node } from "ts-morph";
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

interface A11yIssue {
  element: string;
  issue: string;
  suggestion: string;
  line: number;
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
      fileName: z.string().describe("Absolute path to the component file")
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
      filePath: z.string().describe("Absolute path to component file")
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

server.registerTool(
  "generate_component_tree",
  {
    description:
      "Generates a Mermaid.js dependency graph of React components within a file (showing which component renders which).",
    inputSchema: {
      filePath: z.string().describe("Absolute path to component file")
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
      const mermaidLines = new Set<string>();
      let hasComponents = false;

      const extractJsxRelationships = (
        parentName: string,
        parentNode: Node
      ) => {
        const jsxElements = [
          ...parentNode.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
          ...parentNode.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement)
        ];

        for (const element of jsxElements) {
          const name = element.getTagNameNode().getText();
          if (/^[A-Z]/.test(name)) {
            mermaidLines.add(`  ${parentName} --> ${name}`);
            hasComponents = true;
          }
        }
      };

      // Check arrow functions
      const varDecls = sourceFile.getDescendantsOfKind(
        SyntaxKind.VariableDeclaration
      );
      for (const decl of varDecls) {
        const init = decl.getInitializer();
        const name = decl.getName();

        if (name && /^[A-Z]/.test(name) && init) {
          if (Node.isArrowFunction(init) || Node.isCallExpression(init)) {
            extractJsxRelationships(name, init);
          }
        }
      }

      // Check standard function declarations
      const funcDecls = sourceFile.getDescendantsOfKind(
        SyntaxKind.FunctionDeclaration
      );
      for (const decl of funcDecls) {
        const name = decl.getName();
        if (name && /^[A-Z]/.test(name)) {
          extractJsxRelationships(name, decl);
        }
      }

      project.removeSourceFile(sourceFile);

      if (!hasComponents || mermaidLines.size === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No component relationships found in this file."
            }
          ]
        };
      }

      const mermaidGraph = [
        "```mermaid",
        "graph TD",
        ...Array.from(mermaidLines),
        "```"
      ].join("\n");

      return {
        content: [
          {
            type: "text",
            text: mermaidGraph
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
  "audit_accessibility",
  {
    description:
      "Scans a React component for common acccessibility (a11y) issues (e.g., missing alt tags on images, missing aria-labels).",
    inputSchema: {
      filePath: z.string().describe("Absolute path to component file")
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
      const a11yIssues: A11yIssue[] = [];

      const jsxElements = [
        ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
        ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement)
      ];

      for (const element of jsxElements) {
        const tagName = element.getTagNameNode().getText();
        const attributes = element.getAttributes();
        const line = element.getStartLineNumber();

        const hasAttr = (name: string) =>
          attributes.some(
            (a) => Node.isJsxAttribute(a) && a.getNameNode().getText()
          );

        if (tagName === "img" && !hasAttr("alt")) {
          a11yIssues.push({
            element: tagName,
            issue: "Missing 'alt' attribute",
            suggestion:
              "Add an 'alt' attribute for screen readers. Use alt=\"\" if the image is purely decorative.",
            line
          });
        }

        if (tagName === "a" && !hasAttr("href")) {
          a11yIssues.push({
            element: tagName,
            issue: "Missing 'href' attribute",
            suggestion:
              "Anchor tags must have an href attribute to be keyboard focusable and recognised as links. Add href attribute.",
            line
          });
        }

        if (tagName === "button" && !hasAttr("aria-label")) {
          if (Node.isJsxSelfClosingElement(element)) {
            a11yIssues.push({
              element: tagName,
              issue: "Self-closing button lacks accessible name",
              suggestion: "Add an 'aria-label' attribute.",
              line
            });
          }
        }
      }

      project.removeSourceFile(sourceFile);

      if (a11yIssues.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No accessibility issues found."
            }
          ]
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ accessibilityIssues: a11yIssues }, null, 2)
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

server.registerTool(
  "extract_ui_tokens",
  {
    description: "",
    inputSchema: {
      filePath: z.string()
    }
  },
  async ({ filePath }) => {
    return {
      content: [
        {
          type: "text",
          text: ""
        }
      ]
    };
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
