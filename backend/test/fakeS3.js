// Tiny in-memory S3-compatible server (path-style) implementing just what the app uses.
import http from "node:http";
import crypto from "node:crypto";

const xml = (body) => `<?xml version="1.0" encoding="UTF-8"?>${body}`;
const esc = (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function startFakeS3() {
  const objects = new Map(); // key -> { body, lastModified }
  const uploads = new Map(); // uploadId -> { key, parts: Map, initiated }

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const url = new URL(req.url, "http://x");
      const [, , ...rest] = url.pathname.split("/");
      const key = rest.map(decodeURIComponent).join("/");
      const q = url.searchParams;
      const body = Buffer.concat(chunks);
      const send = (status, text = "", headers = {}) => {
        res.writeHead(status, { "Content-Type": "application/xml", ...headers });
        res.end(text);
      };
      const etag = `"${crypto.createHash("md5").update(body).digest("hex")}"`;

      if (req.method === "GET" && !key && q.has("uploads")) {
        const list = [...uploads.entries()]
          .map(([id, u]) => `<Upload><Key>${esc(u.key)}</Key><UploadId>${id}</UploadId><Initiated>${u.initiated.toISOString()}</Initiated></Upload>`)
          .join("");
        return send(200, xml(`<ListMultipartUploadsResult><IsTruncated>false</IsTruncated>${list}</ListMultipartUploadsResult>`));
      }
      if (req.method === "GET" && !key) {
        const list = [...objects.entries()]
          .map(([k, o]) => `<Contents><Key>${esc(k)}</Key><Size>${o.body.length}</Size><LastModified>${o.lastModified.toISOString()}</LastModified><ETag>"x"</ETag></Contents>`)
          .join("");
        return send(200, xml(`<ListBucketResult><IsTruncated>false</IsTruncated><KeyCount>${objects.size}</KeyCount>${list}</ListBucketResult>`));
      }
      if (req.method === "POST" && q.has("uploads")) {
        const id = crypto.randomUUID();
        uploads.set(id, { key, parts: new Map(), initiated: new Date() });
        return send(200, xml(`<InitiateMultipartUploadResult><Key>${esc(key)}</Key><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`));
      }
      if (req.method === "PUT" && q.has("uploadId")) {
        const upload = uploads.get(q.get("uploadId"));
        if (!upload) return send(404, xml("<Error><Code>NoSuchUpload</Code></Error>"));
        upload.parts.set(Number(q.get("partNumber")), body);
        return send(200, "", { ETag: etag });
      }
      if (req.method === "POST" && q.has("uploadId")) {
        const upload = uploads.get(q.get("uploadId"));
        if (!upload) return send(404, xml("<Error><Code>NoSuchUpload</Code></Error>"));
        const joined = Buffer.concat([...upload.parts.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => b));
        objects.set(key, { body: joined, lastModified: new Date() });
        uploads.delete(q.get("uploadId"));
        return send(200, xml(`<CompleteMultipartUploadResult><Key>${esc(key)}</Key><ETag>"x"</ETag></CompleteMultipartUploadResult>`));
      }
      if (req.method === "DELETE" && q.has("uploadId")) {
        uploads.delete(q.get("uploadId"));
        return send(204);
      }
      if (req.method === "PUT") {
        objects.set(key, { body, lastModified: new Date() });
        return send(200, "", { ETag: etag });
      }
      if (req.method === "HEAD") {
        const object = objects.get(key);
        if (!object) return send(404);
        res.writeHead(200, { "Content-Length": object.body.length, ETag: '"x"' });
        return res.end();
      }
      if (req.method === "DELETE") {
        objects.delete(key);
        return send(204);
      }
      send(400, xml("<Error><Code>NotImplemented</Code></Error>"));
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { endpoint: `http://127.0.0.1:${server.address().port}`, objects, uploads, close: () => server.close() };
}
