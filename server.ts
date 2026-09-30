/**
 * SecureShare Local Dev & Production Full-Stack Server
 * Serves vanilla frontend, routes Netlify serverless functions, and manages file streaming
 */

import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const isProduction = process.env.NODE_ENV === 'production';

// Support JSON and URL-encoded bodies with 50MB limit
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Adapter to run Netlify Functions in Express
async function handleNetlifyFunction(fnName: string, req: Request, res: Response) {
  const functionPath = path.resolve(process.cwd(), 'netlify', 'functions', `${fnName}.js`);
  if (!fs.existsSync(functionPath)) {
    return res.status(404).json({ error: `Function ${fnName} not found` });
  }

  try {
    // Bust require cache in dev to allow immediate hot reloading of backend logic
    delete require.cache[require.resolve(functionPath)];
    const module = require(functionPath);
    const handler = module.handler;

    if (typeof handler !== 'function') {
      return res.status(500).json({ error: `Function ${fnName} does not export a handler` });
    }

    // Adapt Express req -> Netlify event
    const event = {
      httpMethod: req.method,
      headers: req.headers as Record<string, string>,
      queryStringParameters: req.query as Record<string, string>,
      body: typeof req.body === 'string' ? req.body : JSON.stringify(req.body),
      path: req.path
    };

    const context = {};
    const result = await handler(event, context);

    if (result.headers) {
      Object.entries(result.headers).forEach(([k, v]) => {
        res.setHeader(k, v as string);
      });
    }

    res.status(result.statusCode || 200).send(result.body);
  } catch (err: any) {
    console.error(`[Server] Error executing Netlify function ${fnName}:`, err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
}

// Netlify Functions routing
app.all('/api/upload', (req: Request, res: Response) => {
  handleNetlifyFunction('save-file', req, res);
});

app.all('/.netlify/functions/:name', (req: Request, res: Response) => {
  handleNetlifyFunction(req.params.name, req, res);
});

app.all('/api/:name', (req: Request, res: Response) => {
  handleNetlifyFunction(req.params.name, req, res);
});

// Dev fallback for direct file streaming when Service Role Key is in demo mode
app.get('/api/download-direct', (req: Request, res: Response) => {
  const { devStore } = require('./netlify/functions/_supabase.js');
  const fileId = req.query.file_id as string;
  const file = devStore.files.find((f: any) => f.id === fileId);

  if (!file) {
    return res.status(404).send('File not found');
  }

  const storedBuffer = devStore.storageBuckets.get(`vault/${file.file_path}`);
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.file_name)}"`);
  res.setHeader('Content-Type', file.file_type || 'application/octet-stream');

  if (storedBuffer) {
    res.send(storedBuffer);
  } else {
    // Generate a placeholder encrypted buffer demo text
    const sampleContent = Buffer.from(
      `--- SECURESHARE ENCRYPTED VAULT FILE ---\nFile Name: ${file.file_name}\nFile Size: ${file.file_size} bytes\nCreated: ${file.created_at}\n\n[End of secure stream]\n`
    );
    res.send(sampleContent);
  }
});

// Direct upload fallback endpoint for local demo if direct Supabase upload has no service role key
app.post('/api/upload-vault-file', (req: Request, res: Response) => {
  const { devStore, isRealSupabaseConfigured, supabase, SUPABASE_STORAGE_BUCKET } = require('./netlify/functions/_supabase.js');
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const jwt = require('jsonwebtoken');
  const SESSION_SECRET = process.env.SESSION_SECRET || 'secureshare-super-secret-jwt-key-change-in-production-2026';
  let authUser: any;
  try {
    authUser = jwt.verify(authHeader.split(' ')[1], SESSION_SECRET);
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const { fileName, fileType, fileSize, fileBase64 } = req.body;
  if (!fileName || !fileBase64) {
    return res.status(400).json({ error: 'fileName and fileBase64 required' });
  }

  const buffer = Buffer.from(fileBase64, 'base64');
  const timestamp = Date.now();
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath = `${authUser.userId}/${timestamp}_${safeName}`;

  if (isRealSupabaseConfigured && supabase) {
    supabase.storage
      .from(SUPABASE_STORAGE_BUCKET)
      .upload(filePath, buffer, { contentType: fileType, upsert: false })
      .then(({ data, error }: any) => {
        if (error) {
          console.error('[Upload] Supabase Storage upload error:', error);
          return res.status(500).json({ error: error.message });
        }
        return res.json({ success: true, filePath, path: filePath });
      })
      .catch((err: any) => {
        res.status(500).json({ error: err.message });
      });
  } else {
    // Store in dev memory map
    devStore.storageBuckets.set(`vault/${filePath}`, buffer);
    return res.json({ success: true, filePath, path: filePath });
  }
});

// Setup Static or Vite dev middleware
async function setupApp() {
  // Public directory static files
  const publicDir = path.resolve(process.cwd(), 'public');
  app.use(express.static(publicDir));

  // Route /share/:token to /share.html
  app.get('/share/:token', (req, res) => {
    res.sendFile(path.join(publicDir, 'share.html'));
  });

  // Verify transport check in background
  try {
    const { verifyTransport } = require('./netlify/functions/_mailer.js');
    verifyTransport().catch(() => {});
  } catch (e) {}

  // If in dev mode, also mount Vite middleware for anything else
  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  // Catch-all for HTML routing
  app.get('*', (req, res) => {
    const requestedFile = path.join(publicDir, req.path);
    if (fs.existsSync(requestedFile) && fs.statSync(requestedFile).isFile()) {
      return res.sendFile(requestedFile);
    }
    // Default to index.html
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SecureShare] Server running on http://0.0.0.0:${PORT}`);
  });
}

setupApp();
