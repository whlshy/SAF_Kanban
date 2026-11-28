import {
  defineConfig,
} from 'vite';
import react from "@vitejs/plugin-react-swc";
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';
import fs from 'fs';

// 根據環境選擇配置文件
const isDev = process.env.NODE_ENV === 'development';
const configFileName = isDev ? 'config.dev.json' : 'config.json';
const config = JSON.parse(fs.readFileSync(path.resolve(__dirname, configFileName), 'utf-8'));
const {
  title
} = config;
// Shown in the footer; bump it in package.json with each release.
const { version } = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'));

export default defineConfig(({
  mode
}) => {
  const isProd = mode === 'production'
  // `vite build --mode desktop` builds the UI for the desktop app's local server
  // (desktop/server): served from the root, with no service worker.
  const isLocal = mode === 'desktop'
  const base = isProd ? '/SAF_Kanban/' : '/'
  const outDir = isLocal ? 'dist-local' : 'dist'

  return {
    server: {
      host: true,
      port: 1001,
      fs: {
        strict: false, // 這有時候會解決路徑問題
      },
      historyApiFallback: true, // 對於 React Router，開啟這個選項以處理瀏覽器直接訪問子路由
    },
    base, // 公共路徑
    plugins: [
      react(), // 使用 React 插件
      !isLocal && create404Plugin(),
      // Makes the site installable and usable offline. The service worker is
      // registered from src/pwa.jsx, which also offers new versions.
      VitePWA({
        disable: isLocal,
        registerType: 'prompt',
        injectRegister: false,
        includeAssets: ['favicon.svg', 'favicon-32.png', 'apple-touch-icon.png'],
        manifest: {
          id: base,
          name: 'SAF Kanban',
          short_name: 'SAF Kanban',
          description: 'A kanban board that keeps its data in your own Google Sheet.',
          display: 'standalone',
          // The dark header and page; a light theme recolors the bar once loaded.
          theme_color: '#1f1f1f',
          background_color: '#0D1117',
          icons: [
            { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
          globIgnores: ['404.html', 'assets/mermaid/**'],
          cleanupOutdatedCaches: true,
          runtimeCaching: [
            {
              // Board data: always ask Google first; without a connection,
              // answer with what was loaded last time.
              urlPattern: /^https:\/\/sheets\.googleapis\.com\//,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'sheets-data',
                expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 30 },
                cacheableResponse: { statuses: [200] },
              },
            },
            {
              // Mermaid diagram chunks are loaded on demand when a task uses
              // ```mermaid and cached after first use so offline works without
              // bloating the initial PWA precache.
              urlPattern: /\/assets\/mermaid\/.*\.js$/,
              handler: 'CacheFirst',
              options: {
                cacheName: 'mermaid-chunks',
                expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 90 },
                cacheableResponse: { statuses: [200] },
              },
            },
          ],
        },
      }),
    ],
    resolve: {
      alias: {
        '@': '/src', // 簡化導入
        Config: path.resolve(__dirname, configFileName), // 根據環境選擇配置文件
      },
      extensions: ['.js', '.jsx', '.tsx'], // 自定義擴展名
    },
    define: {
      __APP_VERSION__: JSON.stringify(version),
      'process.env': {
        NODE_ENV: JSON.stringify(process.env.NODE_ENV),
        TITLE: JSON.stringify(title), // 將 title 變數傳遞到前端
      },
    },
    assetsInclude: ['**/*.svg', '**/*.png', '**/*.mp4'], // 包括圖像資產
    build: {
      outDir,
      chunkSizeWarningLimit: 1600,
      rollupOptions: {
        output: {
          chunkFileNames(chunkInfo) {
            if (isMermaidRuntimeChunk(chunkInfo)) {
              return 'assets/mermaid/[name]-[hash].js';
            }
            return 'assets/[name]-[hash].js';
          },
          manualChunks(id) {
            if (id.includes("node_modules")) {
              const pkg = id.toString().split("node_modules/")[1].split("/")[0].toString();
              if (isMarkdownChunkPackage(pkg)) return "markdown";
              if (isMermaidChunkPackage(pkg)) return undefined;
              return pkg;
            }
          },
        },
      },
    },
  }
});

const MARKDOWN_PREFIXES = [
  "remark-",
  "rehype-",
  "mdast-",
  "hast-",
  "micromark",
  "unist-",
  "vfile",
  "character-entities",
  "estree-util-",
];

const MARKDOWN_PACKAGES = new Set([
  "react-markdown",
  "unified",
  "@ungap",
  "bail",
  "ccount",
  "character-reference-invalid",
  "comma-separated-tokens",
  "debug",
  "decode-named-character-reference",
  "dequal",
  "devlop",
  "escape-string-regexp",
  "extend",
  "html-url-attributes",
  "inline-style-parser",
  "is-alphabetical",
  "is-alphanumerical",
  "is-decimal",
  "is-hexadecimal",
  "is-plain-obj",
  "longest-streak",
  "markdown-table",
  "ms",
  "parse-entities",
  "property-information",
  "space-separated-tokens",
  "stringify-entities",
  "style-to-object",
  "trim-lines",
  "trough",
  "zwitch",
]);

function isMarkdownChunkPackage(pkg) {
  return MARKDOWN_PACKAGES.has(pkg) || MARKDOWN_PREFIXES.some((prefix) => pkg.startsWith(prefix));
}

const MERMAID_PREFIXES = ["d3-", "@chevrotain", "@mermaid-js", "@iconify", "cytoscape"];
const MERMAID_PACKAGES = new Set([
  "mermaid",
  "d3",
  "dagre-d3-es",
  "elkjs",
  "katex",
  "khroma",
  "lodash-es",
  "marked",
  "dompurify",
  "dayjs",
  "chevrotain",
  "cose-base",
  "layout-base",
  "roughjs",
  "hachure-fill",
  "points-on-curve",
  "points-on-path",
  "path-data-parser",
  "delaunator",
  "robust-predicates",
  "internmap",
  "es-toolkit",
  "ts-dedent",
  "@braintree",
  "@upsetjs",
]);

function isMermaidChunkPackage(pkg) {
  return MERMAID_PACKAGES.has(pkg) || MERMAID_PREFIXES.some((prefix) => pkg.startsWith(prefix));
}

function isMermaidRuntimeChunk(chunkInfo) {
  const ids = chunkInfo.moduleIds || [];
  if (chunkInfo.facadeModuleId) ids.push(chunkInfo.facadeModuleId);
  return ids.some((id) => {
    if (!id.includes("node_modules/")) return false;
    const pkg = id.split("node_modules/")[1].split("/")[0];
    return isMermaidChunkPackage(pkg);
  });
}

// 自動複製 index.html 為 404.html，並同步輸出純 CLI 一鍵安裝腳本至 GitHub Pages 根目錄
function create404Plugin() {
  return {
    name: 'create-404-plugin',
    closeBundle() {
      const indexPath = path.resolve(__dirname, 'dist/index.html')
      const notFoundPath = path.resolve(__dirname, 'dist/404.html')

      if (fs.existsSync(indexPath)) {
        fs.copyFileSync(indexPath, notFoundPath)
        console.log('✅ Copied index.html → 404.html')
      } else {
        console.warn('⚠️ index.html not found after build')
      }

      for (const name of ['install.ps1', 'install.sh']) {
        const src = path.resolve(__dirname, 'scripts', name)
        const dst = path.resolve(__dirname, 'dist', name)
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, dst)
          console.log(`✅ Copied scripts/${name} → dist/${name}`)
        }
      }
    }
  }
}