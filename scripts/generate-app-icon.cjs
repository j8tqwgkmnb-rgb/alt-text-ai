const { createCanvas } = require("@napi-rs/canvas");
const fs = require("fs");
const path = require("path");

// Shopify app icon: 1200x1200 recommended
const SIZE = 1200;
const canvas = createCanvas(SIZE, SIZE);
const ctx = canvas.getContext("2d");

// Background - indigo/purple brand color
ctx.fillStyle = "#5c6ac4";
ctx.fillRect(0, 0, SIZE, SIZE);

// Rounded rectangle background with subtle gradient effect
const gradient = ctx.createLinearGradient(0, 0, SIZE, SIZE);
gradient.addColorStop(0, "#5c6ac4");
gradient.addColorStop(1, "#4553b5");
ctx.fillStyle = gradient;
roundRect(ctx, 0, 0, SIZE, SIZE, 200);
ctx.fill();

// White circle for the "eye/lens" concept
ctx.fillStyle = "rgba(255, 255, 255, 0.15)";
ctx.beginPath();
ctx.arc(SIZE / 2, SIZE / 2, 400, 0, Math.PI * 2);
ctx.fill();

// Image icon (simplified mountain/image)
ctx.fillStyle = "#ffffff";

// Draw simplified image frame
const frameX = 300, frameY = 320, frameW = 600, frameH = 480;
ctx.lineWidth = 40;
ctx.strokeStyle = "#ffffff";
roundRect(ctx, frameX, frameY, frameW, frameH, 40);
ctx.stroke();

// Mountain shape inside frame
ctx.fillStyle = "#ffffff";
ctx.beginPath();
ctx.moveTo(frameX + 40, frameY + frameH - 40);
ctx.lineTo(frameX + 200, frameY + 200);
ctx.lineTo(frameX + 340, frameY + 340);
ctx.lineTo(frameX + 400, frameY + 260);
ctx.lineTo(frameX + frameW - 40, frameY + frameH - 40);
ctx.closePath();
ctx.fill();

// Sun circle
ctx.beginPath();
ctx.arc(frameX + frameW - 140, frameY + 140, 60, 0, Math.PI * 2);
ctx.fill();

// "ALT" text below frame
ctx.fillStyle = "#ffffff";
ctx.font = "bold 120px sans-serif";
ctx.textAlign = "center";
ctx.fillText("ALT", SIZE / 2, frameY + frameH + 140);

// Checkmark accent
ctx.strokeStyle = "#a8f0c6";
ctx.lineWidth = 30;
ctx.lineCap = "round";
ctx.lineJoin = "round";
ctx.beginPath();
ctx.moveTo(SIZE / 2 + 180, frameY + frameH + 70);
ctx.lineTo(SIZE / 2 + 220, frameY + frameH + 110);
ctx.lineTo(SIZE / 2 + 300, frameY + frameH + 30);
ctx.stroke();

// Save
const dir = path.join(__dirname, "..", "screenshots");
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
const buf = canvas.toBuffer("image/png");
fs.writeFileSync(path.join(dir, "app-icon-1200x1200.png"), buf);
console.log("Created app-icon-1200x1200.png");

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
