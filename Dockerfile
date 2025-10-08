# 使用 Node.js 官方鏡像
FROM node:18-alpine

# 安裝 FFmpeg 和其他必要工具
RUN apk add --no-cache \
    ffmpeg \
    wget \
    && rm -rf /var/cache/apk/*

# 設置工作目錄
WORKDIR /app

# 複製 package.json 和 package-lock.json
COPY package*.json ./

# 安裝 npm 依賴
RUN npm install --only=production && npm cache clean --force

# 複製應用程式代碼
COPY app.js ./

# 創建非 root 用戶
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# 更改文件所有權
RUN chown -R nodejs:nodejs /app

# 切換到非 root 用戶
USER nodejs

# 暴露端口
EXPOSE 8080

# 健康檢查
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

# 啟動應用程式
CMD ["node", "app.js"]