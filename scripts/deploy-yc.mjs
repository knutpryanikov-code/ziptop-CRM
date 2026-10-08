import { readdir } from 'node:fs/promises';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, relative, extname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const BUCKET = process.env.BUCKET_NAME || 'xn--g1acsdbq.xn--p1ai';
const DEPLOY_PREFIX = (process.env.DEPLOY_PREFIX || '').replace(/^\/+|\/+$/g, '');
const DIST_DIR = process.env.DIST_DIR ? resolve(process.cwd(), process.env.DIST_DIR) : join(process.cwd(), 'dist');
const CACHE_DIR = join(process.cwd(), '.build_cache');
const deploymentId = `${BUCKET}-${DEPLOY_PREFIX || 'root'}`.replace(/[^a-zA-Z0-9._-]/g, '_');
const HASH_CACHE_FILE = join(CACHE_DIR, `deploy_hashes_${deploymentId}.json`);
const PARTIAL_DEPLOY = process.env.PARTIAL_DEPLOY === '1';
const DEPLOY_INCLUDE = (process.env.DEPLOY_INCLUDE || '').split(',').map((v) => v.trim()).filter(Boolean);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

function getFileMd5(filePath) {
  const buffer = readFileSync(filePath);
  return createHash('md5').update(buffer).digest('hex');
}

function shouldDeploy(relPath) {
  return DEPLOY_INCLUDE.length === 0 || DEPLOY_INCLUDE.some((path) => relPath === path || relPath.startsWith(path));
}

async function getFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await getFiles(fullPath)));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function getCliPath() {
  if (process.env.YC_PATH) return process.env.YC_PATH;
  const homeYc = `${process.env.HOME}/yandex-cloud/bin/yc`;
  if (existsSync(homeYc)) return homeYc;
  return 'yc';
}

async function uploadFile(ycPath, filePath, index, total) {
  const relPath = relative(DIST_DIR, filePath);
  const objectKey = DEPLOY_PREFIX ? `${DEPLOY_PREFIX}/${relPath}` : relPath;
  const ext = extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  const args = [
    'storage',
    's3api',
    'put-object',
    '--bucket',
    BUCKET,
    '--key',
    objectKey,
    '--body',
    filePath,
    '--content-type',
    contentType,
  ];

  if (relPath.startsWith('_astro/')) {
    args.push('--cache-control', 'public, max-age=31536000, immutable');
  } else if (ext === '.html') {
    args.push('--cache-control', 'public, max-age=0, must-revalidate');
  }

  try {
    await execFileAsync(ycPath, args);
    process.stdout.write(`\r[${index + 1}/${total}] 📤 Uploaded ${objectKey} (${contentType})`);
  } catch (err) {
    console.error(`\nFailed to upload ${relPath}:`, err.message);
    throw err;
  }
}

async function main() {
  const isForce = process.argv.includes('--force');
  const isPrune = process.argv.includes('--prune');

  if (!existsSync(DIST_DIR)) {
    throw new Error('dist/ is missing. Run a production build before deployment.');
  }

  const ycPath = getCliPath();

  console.log(`🔍 Scanning ${DIST_DIR}...`);
  const allFiles = await getFiles(DIST_DIR);
  const deployFiles = allFiles.filter((filePath) => shouldDeploy(relative(DIST_DIR, filePath)));

  // 1. Load previous deployment hashes
  let previousHashes = {};
  if (!isForce && existsSync(HASH_CACHE_FILE)) {
    try {
      previousHashes = JSON.parse(readFileSync(HASH_CACHE_FILE, 'utf-8'));
    } catch {
      previousHashes = {};
    }
  }

  // 2. Compute current MD5 hashes and identify changed/new files
  const currentHashes = {};
  const filesToUpload = [];

  for (const filePath of deployFiles) {
    const relPath = relative(DIST_DIR, filePath);
    const hash = getFileMd5(filePath);
    currentHashes[relPath] = hash;

    if (isForce || previousHashes[relPath] !== hash) {
      filesToUpload.push(filePath);
    }
  }

  const unchangedCount = deployFiles.length - filesToUpload.length;

  console.log(`📊 Files selected for deploy: ${deployFiles.length}${deployFiles.length !== allFiles.length ? ` (of ${allFiles.length} in build)` : ''}`);
  console.log(`   ├─ ⚡ Unchanged (skipped): ${unchangedCount} files`);
  console.log(`   └─ 🆕 Changed / New to upload: ${filesToUpload.length} files`);

  if (filesToUpload.length === 0) {
    console.log(`\n✨ S3 bucket is already fully up-to-date! No files needed uploading.`);
    console.log(`🔗 Live URL: https://зиптоп.рф/${DEPLOY_PREFIX ? DEPLOY_PREFIX + '/' : ''}`);
    return;
  }

  console.log(`\n🚀 Uploading ${filesToUpload.length} changed files to s3://${BUCKET}/...`);

  const CONCURRENCY = 12;
  const total = filesToUpload.length;
  const queue = [...filesToUpload.entries()];

  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (!item) break;
        const [idx, file] = item;
        await uploadFile(ycPath, file, idx, total);
      }
    })
  );

  // 3. Optional prune: only clean up files previously uploaded by this script
  if (isPrune && !PARTIAL_DEPLOY && DEPLOY_INCLUDE.length === 0) {
    const deletedFiles = Object.keys(previousHashes).filter((relPath) => !(relPath in currentHashes));
    if (deletedFiles.length > 0) {
      console.log(`\n🗑️ Found ${deletedFiles.length} removed files to delete from s3://${BUCKET}/...`);
      for (const relPath of deletedFiles) {
        try {
          await execFileAsync(ycPath, [
            'storage',
            's3api',
            'delete-object',
            '--bucket',
            BUCKET,
            '--key',
            DEPLOY_PREFIX ? `${DEPLOY_PREFIX}/${relPath}` : relPath,
          ]);
          console.log(`   - 🗑️ Deleted s3://${BUCKET}/${relPath}`);
        } catch (err) {
          console.warn(`   ⚠️ Could not delete ${relPath} from S3:`, err.message);
        }
      }
    }
  }

  // 4. Save updated hashes
  try {
    if (!existsSync(CACHE_DIR)) {
      mkdirSync(CACHE_DIR, { recursive: true });
    }
    const hashesToSave = PARTIAL_DEPLOY || DEPLOY_INCLUDE.length > 0
      ? { ...previousHashes, ...currentHashes }
      : currentHashes;
    writeFileSync(HASH_CACHE_FILE, JSON.stringify(hashesToSave, null, 2), 'utf-8');
  } catch (e) {
    console.warn('Failed to save deploy hash cache:', e);
  }

  console.log(`\n\n✅ Successfully synchronized s3://${BUCKET}/ (uploaded: ${total})`);
  console.log(`🔗 Live URL: https://зиптоп.рф/${DEPLOY_PREFIX ? DEPLOY_PREFIX + '/' : ''}`);
}

main().catch((err) => {
  console.error('\n❌ Upload failed:', err);
  process.exit(1);
});
