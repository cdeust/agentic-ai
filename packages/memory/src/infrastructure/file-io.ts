/**
 * Generic filesystem operations for JSON and text files.
 *
 * - readJson returns parsed object or null (never throws)
 * - writeJson creates parent directories as needed
 * - All text operations use UTF-8 encoding
 *
 * Layer: INFRASTRUCTURE — pure I/O boundary, no core/domain imports.
 * source: Cortex mcp_server/infrastructure/file_io.py
 */

import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Read and parse a JSON file. Returns null if missing or corrupt.
 *
 * precondition:  filePath is a well-formed path string.
 * postcondition: returns parsed JSON value if file exists and is valid JSON;
 *   returns null on any error (file missing, parse failure, I/O error).
 *
 * source: Cortex mcp_server/infrastructure/file_io.py:read_json
 */
export function readJson(filePath: string): unknown | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const text = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(text) as unknown;
  } catch (e) {
    process.stderr.write(
      `[methodology-agent] Failed to read ${filePath}: ${String(e)}\n`,
    );
    return null;
  }
}

/**
 * Write an object as JSON, creating parent directories as needed.
 *
 * precondition:  data is JSON-serializable; filePath is a well-formed path.
 * postcondition: file at filePath contains JSON.stringify(data, null, 2);
 *   parent directories are created recursively if absent.
 *
 * source: Cortex mcp_server/infrastructure/file_io.py:write_json
 */
export function writeJson(filePath: string, data: unknown): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

/**
 * Read a text file. Returns null if missing.
 *
 * precondition:  filePath is a well-formed path string.
 * postcondition: returns file contents as UTF-8 string if the file exists;
 *   returns null on any error.
 *
 * source: Cortex mcp_server/infrastructure/file_io.py:read_text_file
 */
export function readTextFile(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return fs.readFileSync(filePath, "utf-8");
  } catch (e) {
    process.stderr.write(
      `[methodology-agent] Failed to read ${filePath}: ${String(e)}\n`,
    );
    return null;
  }
}

/**
 * Ensure a directory exists, creating it recursively if needed.
 *
 * precondition:  dirPath is a well-formed path string.
 * postcondition: the directory at dirPath exists; no error is thrown if it
 *   already exists.
 *
 * source: Cortex mcp_server/infrastructure/file_io.py:ensure_dir
 */
export function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

/**
 * List directory entries. Returns null if missing.
 *
 * precondition:  dirPath is a well-formed path string.
 * postcondition: returns array of entry names if directory exists;
 *   returns null on any error.
 *
 * source: Cortex mcp_server/infrastructure/file_io.py:list_dir
 */
export function listDir(dirPath: string): string[] | null {
  try {
    if (!fs.existsSync(dirPath)) {
      return null;
    }
    return fs.readdirSync(dirPath);
  } catch (e) {
    process.stderr.write(
      `[methodology-agent] Failed to list ${dirPath}: ${String(e)}\n`,
    );
    return null;
  }
}

/**
 * Get file stats. Returns null if missing.
 *
 * precondition:  filePath is a well-formed path string.
 * postcondition: returns fs.Stats object if file exists; null otherwise.
 *
 * source: Cortex mcp_server/infrastructure/file_io.py:stat_file
 */
export function statFile(filePath: string): fs.Stats | null {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}
