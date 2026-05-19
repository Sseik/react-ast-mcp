import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
const server = new Server({
    name: "react-ast-mcp",
    version: "1.0.0"
}, {
    capabilities: {
        tools: {}
    }
});
// Реєструємо інструменти
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "ping",
                description: "Тестовий інструмент для перевірки з'єднання",
                inputSchema: {
                    type: "object",
                    properties: {}
                }
            }
        ]
    };
});
// Обробляємо виклики
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === "ping") {
        return {
            content: [
                {
                    type: "text",
                    text: "Pong! MCP Server is alive and ready to parse AST."
                }
            ]
        };
    }
    throw new Error(`Tool not found: ${request.params.name}`);
});
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("React AST MCP Server running on stdio"); // Використовуємо console.error для логів, щоб не ламати stdio
}
main().catch(console.error);
//# sourceMappingURL=index.js.map