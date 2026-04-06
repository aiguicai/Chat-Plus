const fs = require('fs');
const path = require('path');

// 确保 icons 目录存在
const iconsDir = path.join(__dirname, 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// 简单的 PNG 编码器（不依赖外部库）
class PNGEncoder {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height * 4);
  }

  // 设置像素颜色 (RGBA)
  setPixel(x, y, r, g, b, a = 255) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    const idx = (y * this.width + x) * 4;
    this.data[idx] = r;
    this.data[idx + 1] = g;
    this.data[idx + 2] = b;
    this.data[idx + 3] = a;
  }

  // 绘制填充圆角矩形
  drawRoundedRect(x, y, w, h, radius, color) {
    const [r, g, b, a] = this.parseColor(color);
    for (let py = y; py < y + h; py++) {
      for (let px = x; px < x + w; px++) {
        if (this.isInRoundedRect(px, py, x, y, w, h, radius)) {
          this.setPixel(px, py, r, g, b, a);
        }
      }
    }
  }

  isInRoundedRect(px, py, x, y, w, h, radius) {
    // 检查是否在圆角矩形内
    const left = px < x + radius;
    const right = px >= x + w - radius;
    const top = py < y + radius;
    const bottom = py >= y + h - radius;

    if (left && top) {
      const dx = px - (x + radius);
      const dy = py - (y + radius);
      return dx * dx + dy * dy <= radius * radius;
    }
    if (right && top) {
      const dx = px - (x + w - radius);
      const dy = py - (y + radius);
      return dx * dx + dy * dy <= radius * radius;
    }
    if (left && bottom) {
      const dx = px - (x + radius);
      const dy = py - (y + h - radius);
      return dx * dx + dy * dy <= radius * radius;
    }
    if (right && bottom) {
      const dx = px - (x + w - radius);
      const dy = py - (y + h - radius);
      return dx * dx + dy * dy <= radius * radius;
    }

    return px >= x && px < x + w && py >= y && py < y + h;
  }

  // 绘制填充圆形
  drawCircle(cx, cy, radius, color) {
    const [r, g, b, a] = this.parseColor(color);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= radius * radius) {
          this.setPixel(x, y, r, g, b, a);
        }
      }
    }
  }

  // 绘制气泡形状（带小尾巴的圆形）
  drawBubble(cx, cy, outerRadius, innerRadius, color) {
    const [r, g, b, a] = this.parseColor(color);
    
    // 绘制主圆形
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const dx = x - cx;
        const dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        // 主圆形区域
        if (dist <= outerRadius) {
          this.setPixel(x, y, r, g, b, a);
        }
        
        // 底部小尾巴（气泡的尖角）
        const tailX = cx - outerRadius * 0.3;
        const tailY = cy + outerRadius * 0.6;
        const tailWidth = outerRadius * 0.25;
        const tailHeight = outerRadius * 0.3;
        
        if (x >= tailX - tailWidth && x <= tailX + tailWidth &&
            y >= tailY && y <= tailY + tailHeight) {
          const progress = (y - tailY) / tailHeight;
          const maxWidth = tailWidth * (1 - progress);
          if (Math.abs(x - tailX) <= maxWidth) {
            this.setPixel(x, y, r, g, b, a);
          }
        }
      }
    }
  }

  // 绘制扳手图标
  drawWrench(cx, cy, size, color) {
    const [r, g, b, a] = this.parseColor(color);
    const halfSize = size / 2;
    
    // 扳手头部（圆形环）
    const headRadius = size * 0.35;
    const headCx = cx - halfSize * 0.3;
    const headCy = cy - halfSize * 0.3;
    const innerRadius = headRadius * 0.5;
    
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const dx = x - headCx;
        const dy = y - headCy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        // 扳手头部外圆
        if (dist <= headRadius) {
          // 内部开口（方形切口）
          const squareCut = Math.abs(x - headCx) < innerRadius * 0.7 && 
                           Math.abs(y - headCy) < innerRadius * 0.5;
          if (!squareCut) {
            this.setPixel(x, y, r, g, b, a);
          }
        }
        
        // 扳手手柄
        const handleStartX = headCx + headRadius * 0.5;
        const handleEndX = cx + halfSize * 0.8;
        const handleWidth = size * 0.15;
        
        if (x >= handleStartX && x <= handleEndX) {
          const progress = (x - handleStartX) / (handleEndX - handleStartX);
          const yCenter = headCy + progress * (cy + halfSize * 0.5 - headCy);
          if (Math.abs(y - yCenter) <= handleWidth / 2) {
            this.setPixel(x, y, r, g, b, a);
          }
        }
      }
    }
  }

  // 绘制工具图标（扳手 + 螺丝刀交叉）
  drawToolIcon(cx, cy, size, color) {
    const [r, g, b, a] = this.parseColor(color);
    
    // 简化工具图标：一个扳手形状
    const wrenchSize = size * 0.7;
    this.drawWrench(cx, cy, wrenchSize, color);
  }

  // 绘制闪电符号（代表快速/智能）
  drawLightning(cx, cy, size, color) {
    const [r, g, b, a] = this.parseColor(color);
    
    // 闪电形状的点
    const points = [
      { x: cx, y: cy - size * 0.5 },
      { x: cx + size * 0.15, y: cy - size * 0.1 },
      { x: cx + size * 0.35, y: cy - size * 0.1 },
      { x: cx + size * 0.1, y: cy + size * 0.2 },
      { x: cx + size * 0.25, y: cy + size * 0.5 },
      { x: cx - size * 0.1, y: cy + size * 0.25 },
      { x: cx - size * 0.25, y: cy + size * 0.25 },
      { x: cx - size * 0.05, y: cy - size * 0.15 },
      { x: cx - size * 0.2, y: cy - size * 0.15 },
    ];
    
    // 简单的闪电绘制（用矩形近似）
    // 主竖条
    const barWidth = size * 0.12;
    for (let y = Math.floor(cy - size * 0.5); y <= cy + size * 0.25; y++) {
      for (let x = Math.floor(cx - barWidth); x <= cx + barWidth; x++) {
        this.setPixel(x, y, r, g, b, a);
      }
    }
    // 左侧突出
    for (let y = Math.floor(cy); y <= cy + size * 0.25; y++) {
      for (let x = Math.floor(cx - size * 0.25); x <= cx - barWidth; x++) {
        this.setPixel(x, y, r, g, b, a);
      }
    }
    // 右侧突出
    for (let y = Math.floor(cy - size * 0.1); y <= cy + size * 0.2; y++) {
      for (let x = cx + barWidth; x <= Math.floor(cx + size * 0.25); x++) {
        this.setPixel(x, y, r, g, b, a);
      }
    }
  }

  parseColor(color) {
    if (typeof color === 'string') {
      // 支持十六进制颜色
      if (color.startsWith('#')) {
        const hex = color.slice(1);
        return [
          parseInt(hex.slice(0, 2), 16),
          parseInt(hex.slice(2, 4), 16),
          parseInt(hex.slice(4, 6), 16),
          255
        ];
      }
      // 支持 rgba
      if (color.startsWith('rgba')) {
        const match = color.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
        if (match) {
          return [
            parseInt(match[1]),
            parseInt(match[2]),
            parseInt(match[3]),
            Math.round(parseFloat(match[4]) * 255)
          ];
        }
      }
    }
    return color;
  }

  // 生成 PNG 数据
  toPNG() {
    const zlib = require('zlib');
    
    // PNG 签名
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    
    // IHDR 块
    const ihdrData = Buffer.alloc(13);
    ihdrData.writeUInt32BE(this.width, 0);
    ihdrData.writeUInt32BE(this.height, 4);
    ihdrData[8] = 8; // 位深度
    ihdrData[9] = 6; // 颜色类型（RGBA）
    ihdrData[10] = 0; // 压缩方法
    ihdrData[11] = 0; // 过滤方法
    ihdrData[12] = 0; // 交织方法
    
    const ihdrChunk = this.makeChunk('IHDR', ihdrData);
    
    // IDAT 块（图像数据）
    let rawData = Buffer.alloc(0);
    for (let y = 0; y < this.height; y++) {
      // 每行开头添加过滤字节（0 = 无过滤）
      rawData = Buffer.concat([rawData, Buffer.from([0])]);
      const rowStart = y * this.width * 4;
      const rowData = Buffer.from(this.data.slice(rowStart, rowStart + this.width * 4));
      rawData = Buffer.concat([rawData, rowData]);
    }
    
    const compressedData = zlib.deflateSync(rawData);
    const idatChunk = this.makeChunk('IDAT', compressedData);
    
    // IEND 块
    const iendChunk = this.makeChunk('IEND', Buffer.alloc(0));
    
    return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
  }

  makeChunk(type, data) {
    const typeBuffer = Buffer.from(type);
    const lengthBuffer = Buffer.alloc(4);
    lengthBuffer.writeUInt32BE(data.length);
    
    const crcData = Buffer.concat([typeBuffer, data]);
    const crc = this.crc32(crcData);
    const crcBuffer = Buffer.alloc(4);
    crcBuffer.writeUInt32BE(crc >>> 0);
    
    return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer]);
  }

  crc32(data) {
    let crc = 0xffffffff;
    const table = this.getCRC32Table();
    
    for (let i = 0; i < data.length; i++) {
      crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
    }
    
    return crc ^ 0xffffffff;
  }

  getCRC32Table() {
    if (this.crcTable) return this.crcTable;
    
    this.crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      }
      this.crcTable[i] = c;
    }
    return this.crcTable;
  }
}

// 生成图标的主函数
function generateIcon(size, filename) {
  const encoder = new PNGEncoder(size, size);
  
  // 计算图标元素位置
  const cx = size / 2;
  const cy = size / 2;
  const bubbleRadius = size * 0.42;
  
  // 1. 绘制背景渐变（从中心向外）
  const gradientColors = [
    { r: 99, g: 102, b: 241, offset: 0 },      // 紫色
    { r: 168, g: 85, b: 247, offset: 0.5 },    // 紫红
    { r: 236, g: 72, b: 153, offset: 1 }       // 粉红
  ];
  
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const maxDist = size * 0.5;
      const ratio = Math.min(dist / maxDist, 1);
      
      // 插值颜色
      let color;
      if (ratio < 0.5) {
        const t = ratio / 0.5;
        color = {
          r: Math.round(gradientColors[0].r + (gradientColors[1].r - gradientColors[0].r) * t),
          g: Math.round(gradientColors[0].g + (gradientColors[1].g - gradientColors[0].g) * t),
          b: Math.round(gradientColors[0].b + (gradientColors[1].b - gradientColors[0].b) * t)
        };
      } else {
        const t = (ratio - 0.5) / 0.5;
        color = {
          r: Math.round(gradientColors[1].r + (gradientColors[2].r - gradientColors[1].r) * t),
          g: Math.round(gradientColors[1].g + (gradientColors[2].g - gradientColors[1].g) * t),
          b: Math.round(gradientColors[1].b + (gradientColors[2].b - gradientColors[1].b) * t)
        };
      }
      
      // 圆形区域
      if (dist <= bubbleRadius) {
        encoder.setPixel(x, y, color.r, color.g, color.b, 255);
      }
      
      // 气泡尾巴
      const tailX = cx - bubbleRadius * 0.3;
      const tailY = cy + bubbleRadius * 0.6;
      const tailWidth = bubbleRadius * 0.25;
      const tailHeight = bubbleRadius * 0.3;
      
      if (x >= tailX - tailWidth && x <= tailX + tailWidth &&
          y >= tailY && y <= tailY + tailHeight) {
        const progress = (y - tailY) / tailHeight;
        const maxWidth = tailWidth * (1 - progress);
        if (Math.abs(x - tailX) <= maxWidth) {
          encoder.setPixel(x, y, color.r, color.g, color.b, 255);
        }
      }
    }
  }
  
  // 2. 绘制内部白色聊天气泡轮廓（小一点的气泡）
  const innerBubbleRadius = bubbleRadius * 0.55;
  const innerCx = cx;
  const innerCy = cy - size * 0.05;
  
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - innerCx;
      const dy = y - innerCy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      // 内部小气泡
      if (dist <= innerBubbleRadius) {
        encoder.setPixel(x, y, 255, 255, 255, 255);
      }
      
      // 小气泡尾巴
      const smallTailX = innerCx - innerBubbleRadius * 0.3;
      const smallTailY = innerCy + innerBubbleRadius * 0.5;
      const smallTailWidth = innerBubbleRadius * 0.2;
      const smallTailHeight = innerBubbleRadius * 0.25;
      
      if (x >= smallTailX - smallTailWidth && x <= smallTailX + smallTailWidth &&
          y >= smallTailY && y <= smallTailY + smallTailHeight) {
        const progress = (y - smallTailY) / smallTailHeight;
        const maxWidth = smallTailWidth * (1 - progress);
        if (Math.abs(x - smallTailX) <= maxWidth) {
          encoder.setPixel(x, y, 255, 255, 255, 255);
        }
      }
    }
  }
  
  // 3. 在内部气泡上绘制彩色工具图标（扳手）
  const toolSize = size * 0.35;
  const toolCx = cx + size * 0.08;
  const toolCy = cy + size * 0.02;
  
  // 绘制简化的扳手图标
  const wrenchColor = [147, 51, 234]; // 紫色
  
  // 扳手头部
  const headRadius = toolSize * 0.35;
  const headCx = toolCx - toolSize * 0.2;
  const headCy = toolCy - toolSize * 0.2;
  
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - headCx;
      const dy = y - headCy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      // 扳手头部圆环
      if (dist <= headRadius && dist >= headRadius * 0.4) {
        encoder.setPixel(x, y, wrenchColor[0], wrenchColor[1], wrenchColor[2], 255);
      }
      
      // 扳手手柄
      const handleStartX = headCx + headRadius * 0.3;
      const handleEndX = toolCx + toolSize * 0.4;
      const handleWidth = toolSize * 0.12;
      const handleAngle = Math.PI / 6; // 30 度
      
      const relX = x - handleStartX;
      const relY = y - headCy;
      const rotatedY = relY * Math.cos(handleAngle) - relX * Math.sin(handleAngle);
      
      if (x >= handleStartX && x <= handleEndX && Math.abs(rotatedY) <= handleWidth / 2) {
        encoder.setPixel(x, y, wrenchColor[0], wrenchColor[1], wrenchColor[2], 255);
      }
    }
  }
  
  // 保存文件
  const pngData = encoder.toPNG();
  fs.writeFileSync(filename, pngData);
  console.log(`✓ 已生成图标：${filename} (${size}x${size})`);
}

// 生成所有尺寸的图标
console.log('开始生成 Chat Plus 浏览器插件图标...\n');

generateIcon(16, path.join(iconsDir, 'icon16.png'));
generateIcon(48, path.join(iconsDir, 'icon48.png'));
generateIcon(128, path.join(iconsDir, 'icon128.png'));

console.log('\n✓ 所有图标生成完成！');
console.log('图标设计说明：');
console.log('  - 渐变紫色/粉色圆形气泡背景（代表 Chat）');
console.log('  - 内部白色小气泡轮廓（增强层次感）');
console.log('  - 紫色扳手工具图标（代表工具调用功能）');
