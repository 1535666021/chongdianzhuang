#!/usr/bin/env node
/* ============================================================
 * build-check.js — 构建前后 HTML 结构完整性验证
 * 
 * 无参数：验证源 index.html 完整性（Vite 入口）
 *   --check-dist：验证 dist/index.html 完整性（构建产物）
 * 
 * 退出码：0=通过，1=失败（阻断构建）
 * ============================================================ */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname);
const checkDist = process.argv.includes("--check-dist");

const file = checkDist
  ? path.join(ROOT, "dist", "index.html")
  : path.join(ROOT, "index.html");

if (!fs.existsSync(file)) {
  console.error(`[build-check] 文件不存在: ${file}`);
  process.exit(1);
}

const html = fs.readFileSync(file, "utf-8");

const errors = [];

/* 一、结构完整性检查 */
if (!html.includes("<div id=\"root\">")) {
  errors.push("缺少 <div id=\"root\"> 挂载点（React 无法渲染）");
}
if (!html.includes("</head>")) {
  errors.push("缺少 </head> 闭合标签");
}
if (!html.includes("<body>")) {
  errors.push("缺少 <body> 标签");
}
if (!html.includes("</body>")) {
  errors.push("缺少 </body> 闭合标签");
}
if (!html.includes("</html>")) {
  errors.push("缺少 </html> 闭合标签");
}

/* 二、入口完整性检查 */
if (!checkDist) {
  /* 源 HTML：必须指向 Vite 源码入口 */
  if (!html.includes('src="/src/main.tsx"')) {
    errors.push("源 HTML 缺少 <script type=\"module\" src=\"/src/main.tsx\">（非 Vite 入口）");
  }
} else {
  /* 产物 HTML：检查 base 路径 */
  if (!html.includes('/chongdianzhuang/')) {
    errors.push("产物 HTML 缺少 /chongdianzhuang/ 基础路径");
  }
  if (!html.includes('script type="module"')) {
    errors.push("产物 HTML 缺少 <script type=\"module\"> 入口");
  }
}

/* 三、报告 */
if (errors.length > 0) {
  const label = checkDist ? "[构建产物]" : "[源入口]";
  console.error(`\n[build-check] ${label} 验证失败 (${errors.length} 项):`);
  errors.forEach((e) => console.error(`  • ${e}`));
  console.error("");
  process.exit(1);
}

const target = checkDist ? "构建产物" : "源入口";
console.log(`[build-check] ${target} HTML 结构验证通过`);
