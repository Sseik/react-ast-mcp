import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Project, SyntaxKind, Node } from "ts-morph";
import * as fs from "fs";
import { object } from "zod/v4";

const server = new McpServer({ name: "react-ast", version: "1.0.0" });

const project = new Project({ compilerOptions: { jsx: 1 } });

interface Component {
  name: string;
  propsType?: string | undefined;
}

interface ComponentsResponse {
  components: Component[];
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
      "Analyzes React component and returns its AST structure (names and props)",
    inputSchema: {
      state: z.string()
    }
  },
  async ({ state }) => {
    if (!fs.existsSync(state)) {
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
      const sourceFile = project.addSourceFileAtPath(state);
      const result: ComponentsResponse = { components: [] };

      const varDecls = sourceFile.getDescendantsOfKind(
        SyntaxKind.VariableDeclaration
      );
      for (const decl of varDecls) {
        const init = decl.getInitializer();

        if (init && Node.isArrowFunction(init)) {
          const name = decl.getName();
          if (/^[A-Z]/.test(name)) {
            const compInfo: Component = { name };
            const params = init.getParameters();

            if (params.length) {
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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("React-AST MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main(): ", error);
  process.exit(1);
});
