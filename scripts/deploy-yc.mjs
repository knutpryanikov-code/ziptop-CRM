import { readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile), bucket = process.env.BUCKET_NAME || 'xn--g1acsdbq.xn--p1ai', prefix = (process.env.DEPLOY_PREFIX || '').replace(/^\/+|\/+$/g, ''), dist = join(process.cwd(), 'dist'), yc = process.env.YC_PATH || 'yc';
const types = { '.css':'text/css; charset=utf-8','.html':'text/html; charset=utf-8','.ico':'image/x-icon','.js':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.mjs':'application/javascript; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.webp':'image/webp','.woff':'font/woff','.woff2':'font/woff2' };
async function files(dir) { const entries = await readdir(dir, { withFileTypes: true }); return (await Promise.all(entries.map((entry) => { const path = join(dir, entry.name); return entry.isDirectory() ? files(path) : entry.isFile() ? [path] : []; }))).flat(); }
if (!existsSync(dist)) throw new Error('dist/ is missing. Run a production build before deployment.');
for (const file of await files(dist)) { const path = relative(dist, file), args = ['storage','s3api','put-object','--bucket',bucket,'--key', prefix ? `${prefix}/${path}` : path,'--body',file,'--content-type',types[extname(file)] || 'application/octet-stream']; if (path.startsWith('_astro/')) args.push('--cache-control','public, max-age=31536000, immutable'); if (path.endsWith('.html')) args.push('--cache-control','public, max-age=0, must-revalidate'); await run(yc, args); console.log(`Uploaded ${prefix ? `${prefix}/${path}` : path}`); }
console.log('Deployment complete: https://зиптоп.рф/');
