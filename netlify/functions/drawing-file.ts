import type { Handler } from "@netlify/functions";
import dotenv from "dotenv";
import path from "node:path";
import { Dropbox } from "dropbox";
import { getDropboxAccessToken } from "./lib/dropboxAuth";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const jsonHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function jsonBody(obj: object): string {
  return JSON.stringify(obj);
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: jsonHeaders, body: "" };
  }
  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: jsonHeaders,
      body: jsonBody({ error: "Method not allowed" }),
    };
  }

  const pathParam = event.queryStringParameters?.path;
  if (!pathParam || typeof pathParam !== "string") {
    return {
      statusCode: 400,
      headers: jsonHeaders,
      body: jsonBody({ error: "path query required" }),
    };
  }

  let token: string;
  try {
    token = await getDropboxAccessToken();
  } catch (err) {
    const msg = (err as Error)?.message ?? "Failed to get Dropbox access token";
    console.error("drawing-file: getDropboxAccessToken failed", err);
    return {
      statusCode: 500,
      headers: jsonHeaders,
      body: jsonBody({ error: "Dropbox token error", detail: msg }),
    };
  }

  const dbx = new Dropbox({ accessToken: token });
  try {
    const res = await dbx.filesGetTemporaryLink({ path: pathParam });
    const link = (res.result as { link: string }).link;
    return {
      statusCode: 302,
      headers: {
        Location: link,
        "Access-Control-Allow-Origin": "*",
      },
      body: "",
    };
  } catch (err) {
    console.error("drawing-file: getTemporaryLink failed", err);
    return {
      statusCode: 404,
      headers: jsonHeaders,
      body: jsonBody({ error: "Drawing not found" }),
    };
  }
};
