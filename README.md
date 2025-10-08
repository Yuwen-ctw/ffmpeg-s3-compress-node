# FFmpeg 壓縮服務

這是一個基於 Node.js 和 FFmpeg 的視訊壓縮服務，整合 MinIO 對象存儲。

## 功能特色

- 🎬 視訊壓縮 (使用 libx264 編碼器，CRF=33，30fps)
- 📦 MinIO 整合 (自動下載和上傳)
- 🏥 健康檢查端點
- 🧹 自動清理暫存檔案
- 📝 詳細的執行日誌
- 🐳 Docker 支援

## 環境變數

| 變數名           | 必須 | 預設值    | 說明             |
| ---------------- | ---- | --------- | ---------------- |
| `MINIO_ACCESS`   | ✅   | -         | MinIO 存取金鑰   |
| `MINIO_SECRET`   | ✅   | -         | MinIO 密鑰       |
| `MINIO_ENDPOINT` | ❌   | localhost | MinIO 伺服器地址 |
| `MINIO_PORT`     | ❌   | 9000      | MinIO 端口       |
| `MINIO_USE_SSL`  | ❌   | false     | 是否使用 SSL     |
| `PORT`           | ❌   | 8080      | 服務監聽端口     |

## API 端點

### GET /health

健康檢查端點，檢測服務和 MinIO 連接狀態。

**回應:**

```json
{
  "status": "ok",
  "message": "Server is running and healthy.",
  "minio": "connected",
  "timestamp": "2025-10-07T10:00:00.000Z"
}
```

### POST /compress

壓縮視訊檔案端點。

**請求:**

```json
{
  "bucketName": "videos",
  "objectName": "input-video.mov"
}
```

**回應:**

```json
{
  "success": true,
  "message": "檔案壓縮成功",
  "data": {
    "originalFile": "input-video.mov",
    "compressedFile": "input-video_compressed.mp4",
    "bucketName": "videos",
    "processingTimeMs": 15420
  },
  "timestamp": "2025-10-07T10:00:15.420Z"
}
```

## Docker 使用方式

### 構建鏡像

```bash
docker build -t ffmpeg-s3-compress-node .
```

### 運行容器

```bash
docker run -d \
  --name ffmpeg-s3-compress-node \
  -p 8080:8080 \
  -e MINIO_ACCESS=your_access_key \
  -e MINIO_SECRET=your_secret_key \
  -e MINIO_ENDPOINT=your_minio_host \
  -e MINIO_PORT=9000 \
  -e MINIO_USE_SSL=false \
  ffmpeg-s3-compress-node
```

### 使用 Docker Compose

```yaml
version: '3.8'
services:
  ffmpeg-compress:
    build: .
    ports:
      - '8080:8080'
    environment:
      - MINIO_ACCESS=${MINIO_ACCESS}
      - MINIO_SECRET=${MINIO_SECRET}
      - MINIO_ENDPOINT=minio
      - MINIO_PORT=9000
      - MINIO_USE_SSL=false
    depends_on:
      - minio
```

## 壓縮設定

使用的 FFmpeg 參數：

- `-vcodec libx264`: 使用 H.264 編碼器
- `-crf 33`: 恆定品質模式，數值越高壓縮越多
- `-r 30`: 設定幀率為 30fps

## 錯誤處理

所有錯誤都會記錄到控制台，並返回結構化的錯誤回應：

```json
{
  "success": false,
  "error": "檔案壓縮失敗",
  "details": "具體錯誤訊息",
  "timestamp": "2025-10-07T10:00:00.000Z"
}
```

## 測試

### 健康檢查

```bash
curl http://localhost:8080/health
```

### 壓縮測試

```bash
curl -X POST http://localhost:8080/compress \
  -H "Content-Type: application/json" \
  -d '{
    "bucketName": "test-bucket",
    "objectName": "test-video.mp4"
  }'
```
