import express from "express";
import cors from "cors";
import crypto from "crypto";
import winston from "winston";
import dotenv from "dotenv";
import { z } from "zod";
import { insertLogEntry, getRegisteredApps, queryLogEntries, initializeDatabaseSchema } from "./db.js";
dotenv.config();
// Setup internal winston logger for backend self-logs
const logger = winston.createLogger({
    level: "info",
    format: winston.format.combine(winston.format.timestamp(), winston.format.colorize(), winston.format.printf(({ timestamp, level, message }) => {
        return `[${timestamp}] ${level}: ${message}`;
    })),
    transports: [new winston.transports.Console()],
});
const app = express();
const port = process.env.PORT || 4000;
app.use(cors());
app.use(express.json({ limit: "10mb" })); // Support large logs / payloads
// Validation schema for log ingestion
const LogIngestSchema = z.object({
    appId: z.string().min(1, "appId is required"),
    traceId: z.string().optional(),
    type: z.enum(["log", "transaction"]),
    level: z.enum(["info", "warn", "error", "debug"]),
    message: z.string().optional(),
    timestamp: z.string().optional(),
    payload: z.any().optional(),
});
let sseClients = [];
// Broadcast log entry to all connected SSE clients
function broadcastToSSE(entry) {
    const dataString = `data: ${JSON.stringify(entry)}\n\n`;
    sseClients.forEach(client => {
        try {
            client.res.write(dataString);
        }
        catch (err) {
            logger.error(`Error sending data to SSE client ${client.id}: ${err.message}`);
        }
    });
}
// REST Routes
// 1. Ingest Log Endpoint
app.post("/api/v1/ingest", async (req, res) => {
    try {
        const parseResult = LogIngestSchema.safeParse(req.body);
        if (!parseResult.success) {
            res.status(400).json({
                success: false,
                error: "Validation failed",
                details: parseResult.error.issues,
            });
            return;
        }
        const input = parseResult.data;
        const logId = crypto.randomUUID();
        const timestamp = input.timestamp || new Date().toISOString();
        const entry = {
            id: logId,
            appId: input.appId,
            traceId: input.traceId,
            type: input.type,
            level: input.level,
            message: input.message,
            timestamp,
            payload: input.payload,
        };
        // Save to Database
        await insertLogEntry(entry);
        // Broadcast to UI dashboards in real time
        broadcastToSSE(entry);
        res.status(201).json({
            success: true,
            id: logId,
        });
    }
    catch (err) {
        logger.error(`Ingest failed: ${err.message}`);
        res.status(500).json({ success: false, error: err.message });
    }
});
// 2. Get Registered Apps list
app.get("/api/v1/apps", async (req, res) => {
    try {
        const apps = await getRegisteredApps();
        res.json({ success: true, apps });
    }
    catch (err) {
        logger.error(`Get apps list failed: ${err.message}`);
        res.status(500).json({ success: false, error: err.message });
    }
});
// 3. Query Logs Endpoint
app.get("/api/v1/logs", async (req, res) => {
    try {
        const appId = req.query.appId;
        const level = req.query.level;
        const traceId = req.query.traceId;
        const search = req.query.search;
        const limit = req.query.limit ? parseInt(req.query.limit) : 50;
        const offset = req.query.offset ? parseInt(req.query.offset) : 0;
        const logs = await queryLogEntries({
            appId,
            level,
            traceId,
            search,
            limit,
            offset,
        });
        res.json({ success: true, logs });
    }
    catch (err) {
        logger.error(`Query logs failed: ${err.message}`);
        res.status(500).json({ success: false, error: err.message });
    }
});
// 4. Server-Sent Events (SSE) stream endpoint
app.get("/api/v1/logs/stream", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    const clientId = crypto.randomUUID();
    const newClient = { id: clientId, res };
    sseClients.push(newClient);
    logger.info(`SSE Client connected: ${clientId} (Total active UI connections: ${sseClients.length})`);
    // Send initial ping to establish link
    res.write(`data: ${JSON.stringify({ message: "stream_connected", clientId })}\n\n`);
    req.on("close", () => {
        sseClients = sseClients.filter(client => client.id !== clientId);
        logger.info(`SSE Client disconnected: ${clientId} (Total active UI connections: ${sseClients.length})`);
    });
});
async function startServer() {
    try {
        await initializeDatabaseSchema();
        app.listen(port, () => {
            logger.info(`Central Logger Backend running at http://localhost:${port}`);
        });
    }
    catch (err) {
        logger.error(`Failed to start server: ${err.message}`);
        process.exit(1);
    }
}
startServer();
