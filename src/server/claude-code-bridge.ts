// The LifeHarness tool bridge for Claude Code: a private MCP server (Streamable HTTP) on 127.0.0.1,
// one per Claude Code process, guarded by a random bearer token. Claude Code calls LifeHarness's
// tools through it (they're pre-approved with --allowedTools, so Claude Code's own permission rules
// and hooks still decide). A call is admitted only with Claude Code's unique tool-use id
// (_meta["claudecode/toolUseId"]) and a declared tool name, and its response is held until
// LifeHarness has the real result: a profile update, a drafted plan, or a person's answer.
// Adapted from LearnHarness's tool bridge (src/agent/claude-code/tool-bridge.ts in
// https://github.com/amosblomqvist/learnharness, by Amos Blomqvist, AGPL-3.0-only).
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { JsonObject, TextContent, Tool, ToolResultMessage } from "@earendil-works/pi-ai";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export const BRIDGE_NAME = "lifeharness";
export const MCP_PREFIX = `mcp__${BRIDGE_NAME}__`;
export const IDENTITY_ERROR = "Claude Code compatibility error: a tool call arrived without a unique tool-use id.";

export interface BridgeCall {
  id: string;
  name: string;
  arguments: JsonObject;
}

export interface ToolBridge {
  /** For --mcp-config (a private file: it carries the bearer token). */
  mcpConfig: string;
  /** For --allowedTools. */
  allowedTools: string[];
  /** Calls that arrived and wait for a result. */
  pending(): BridgeCall[];
  resolve(call: BridgeCall, result: ToolResultMessage): void;
  close(): Promise<void>;
}

const toResult = (r: ToolResultMessage): CallToolResult => ({
  content: r.content.filter((c): c is TextContent => c.type === "text").map((c) => ({ type: "text" as const, text: c.text })),
  isError: r.isError,
});

export async function createToolBridge(tools: Tool[], hooks: { onCall(): void; onError(e: Error): void }): Promise<ToolBridge> {
  const token = Buffer.from(`Bearer ${randomBytes(32).toString("hex")}`);
  const held = new Map<BridgeCall, (r: CallToolResult) => void>();
  const seen = new Set<string>();

  const server = new Server({ name: BRIDGE_NAME, version: "1.0.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    // JSON Schema straight through (no TypeBox symbols), exactly as the agent declares it.
    tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: JSON.parse(JSON.stringify(t.parameters)) })),
  }));
  server.setRequestHandler(CallToolRequestSchema, (req, extra) => {
    const id = req.params._meta?.["claudecode/toolUseId"];
    if (typeof id !== "string" || !id.trim() || seen.has(id)) {
      const e = new McpError(ErrorCode.InvalidParams, IDENTITY_ERROR);
      hooks.onError(e);
      throw e;
    }
    if (!tools.some((t) => t.name === req.params.name)) {
      const e = new McpError(ErrorCode.InvalidParams, "Claude Code asked for a tool LifeHarness didn't declare.");
      hooks.onError(e);
      throw e;
    }
    seen.add(id);
    const call: BridgeCall = { id, name: req.params.name, arguments: (req.params.arguments ?? {}) as JsonObject };
    const result = new Promise<CallToolResult>((resolve) => {
      const cancel = () => settle({ content: [{ type: "text", text: "Cancelled." }], isError: true });
      const settle = (r: CallToolResult) => {
        if (!held.delete(call)) return;
        extra.signal.removeEventListener("abort", cancel);
        resolve(r);
      };
      held.set(call, settle);
      extra.signal.addEventListener("abort", cancel, { once: true });
    });
    hooks.onCall();
    return result;
  });

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID(), enableJsonResponse: true });
  await server.connect(transport);
  const httpServer = http.createServer((req, res) => {
    const auth = Buffer.from(req.headers.authorization ?? "");
    if (auth.length !== token.length || !timingSafeEqual(auth, token)) {
      res.writeHead(401).end();
      return;
    }
    transport.handleRequest(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  const port = await new Promise<number>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(0, "127.0.0.1", () => resolve((httpServer.address() as AddressInfo).port));
  }).catch(async (e) => {
    await server.close();
    throw e;
  });

  return {
    mcpConfig: JSON.stringify({ mcpServers: { [BRIDGE_NAME]: { type: "http", url: `http://127.0.0.1:${port}/mcp`, headers: { Authorization: token.toString() } } } }),
    allowedTools: tools.map((t) => `${MCP_PREFIX}${t.name}`),
    pending: () => [...held.keys()],
    resolve: (call, r) => held.get(call)?.(toResult(r)),
    close: async () => {
      for (const settle of held.values()) settle({ content: [{ type: "text", text: "LifeHarness closed this tool call." }], isError: true });
      await server.close().catch(() => {});
      httpServer.closeAllConnections();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}
