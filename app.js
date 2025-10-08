import express from 'express'
import fs from 'fs/promises'
import { createWriteStream, createReadStream } from 'fs'
import path from 'path'
import os from 'os'
import { spawn } from 'child_process'
import { Client as MinioClient } from 'minio'

const app = express()
app.use(express.json())

// 從環境變數讀取 MinIO 設定
const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT || 'localhost'
const MINIO_PORT = parseInt(process.env.MINIO_PORT) || 9000
const MINIO_USE_SSL = process.env.MINIO_USE_SSL === 'true'
const MINIO_ACCESS = process.env.MINIO_ACCESS
const MINIO_SECRET = process.env.MINIO_SECRET

if (!MINIO_ACCESS || !MINIO_SECRET) {
  console.error('❌ 缺少必要的環境變數: MINIO_ACCESS 和 MINIO_SECRET')
  process.exit(1)
}

// 初始化 MinIO 客戶端
const minioClient = new MinioClient({
  endPoint: MINIO_ENDPOINT,
  port: MINIO_PORT,
  useSSL: MINIO_USE_SSL,
  accessKey: MINIO_ACCESS,
  secretKey: MINIO_SECRET,
})

// 健康檢查端點
app.get('/health', async (req, res) => {
  try {
    // 測試 MinIO 連接
    await minioClient.listBuckets()
    res.status(200).json({
      status: 'ok',
      message: 'Server is running and healthy.',
      minio: 'connected',
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('❌ 健康檢查失敗:', error.message)
    res.status(503).json({
      status: 'error',
      message: 'Service unavailable',
      minio: 'disconnected',
      error: error.message,
      timestamp: new Date().toISOString(),
    })
  } finally {
    console.log('-------')
  }
})

// 壓縮服務端點
app.post('/compress', async (req, res) => {
  const startTime = Date.now()
  const { bucketName, objectName } = req.body

  if (!bucketName || !objectName) {
    const error = '缺少必要參數: bucketName 和 objectName'
    console.error('❌', error)
    console.log('-------')
    return res.status(400).json({
      success: false,
      error: error,
      timestamp: new Date().toISOString(),
    })
  }

  const timestamp = Date.now()
  const tmpDir = os.tmpdir()
  const inputFileName = `input-${timestamp}-${path.basename(objectName)}`
  const outputFileName = `output-${timestamp}-compressed.mp4`
  const inputPath = path.join(tmpDir, inputFileName)
  const outputPath = path.join(tmpDir, outputFileName)

  // 生成壓縮後的對象名稱
  const nameWithoutExt = objectName.replace(/\.[^/.]+$/, '')
  const compressedObjectName = `${nameWithoutExt}_compressed.mp4`

  console.log(`🎬 開始壓縮任務:`)
  console.log(`   - Bucket: ${bucketName}`)
  console.log(`   - 原文件: ${objectName}`)
  console.log(`   - 壓縮後: ${compressedObjectName}`)

  try {
    // 1. 從 MinIO 下載檔案
    console.log('📥 正在從 MinIO 下載檔案...')
    const stream = await minioClient.getObject(bucketName, objectName)

    await new Promise((resolve, reject) => {
      const fileStream = createWriteStream(inputPath)
      stream.pipe(fileStream)

      stream.on('error', (err) => {
        fileStream.destroy()
        reject(new Error(`MinIO 下載錯誤: ${err.message}`))
      })

      fileStream.on('finish', async () => {
        // 獲取原始檔案大小
        try {
          const inputStat = await fs.stat(inputPath)
          console.log(
            `✅ 檔案下載完成: ${inputPath} (${(
              inputStat.size /
              1024 /
              1024
            ).toFixed(2)} MB)`
          )
        } catch (statError) {
          console.log(`✅ 檔案下載完成: ${inputPath}`)
        }
        resolve()
      })

      fileStream.on('error', (err) => {
        reject(new Error(`檔案寫入錯誤: ${err.message}`))
      })
    })

    // 2. 使用 FFmpeg 壓縮檔案
    console.log('🔄 正在執行 FFmpeg 壓縮...')
    const ffmpegArgs = [
      '-y', // 覆蓋輸出檔案
      '-i',
      inputPath,
      '-vcodec',
      'libx264',
      '-crf',
      '33',
      '-r',
      '30',
      outputPath,
    ]

    console.log(`[FFMPEG] 執行命令: ffmpeg ${ffmpegArgs.join(' ')}`)

    await new Promise((resolve, reject) => {
      const ffmpegProcess = spawn('ffmpeg', ffmpegArgs)

      let stderr = ''

      ffmpegProcess.stderr.on('data', (data) => {
        stderr += data.toString()
        // 只記錄關鍵進度信息，避免日誌過多
        const progress = data.toString()
        if (progress.includes('time=') || progress.includes('frame=')) {
          process.stdout.write('.')
        }
      })

      ffmpegProcess.on('close', (code) => {
        console.log() // 換行
        if (code === 0) {
          console.log('✅ FFmpeg 壓縮完成')
          resolve()
        } else {
          console.error('❌ FFmpeg 壓縮失敗')
          console.error('FFmpeg stderr:', stderr)
          reject(new Error(`FFmpeg 退出碼: ${code}`))
        }
      })

      ffmpegProcess.on('error', (err) => {
        reject(new Error(`FFmpeg 執行錯誤: ${err.message}`))
      })
    })

    // 3. 獲取檔案大小並上傳壓縮後的檔案到 MinIO
    console.log('📤 正在上傳壓縮後的檔案到 MinIO...')
    const outputStat = await fs.stat(outputPath)
    const inputStat = await fs.stat(inputPath)
    const outputStream = createReadStream(outputPath)

    await minioClient.putObject(bucketName, compressedObjectName, outputStream)

    console.log('✅ 壓縮檔案上傳完成')

    // 4. 清理暫存檔案
    console.log('🧹 清理暫存檔案...')
    try {
      await fs.unlink(inputPath)
      await fs.unlink(outputPath)
      console.log('✅ 暫存檔案清理完成')
    } catch (cleanupError) {
      console.error('⚠️ 清理暫存檔案時發生錯誤:', cleanupError.message)
    }

    // 5. 返回成功結果
    const endTime = Date.now()
    const processingTime = endTime - startTime

    // 計算壓縮比例
    const compressionRatio = (
      ((inputStat.size - outputStat.size) / inputStat.size) *
      100
    ).toFixed(1)

    console.log(
      `🎉 壓縮任務完成，耗時: ${processingTime}ms，原始大小: ${(
        inputStat.size /
        1024 /
        1024
      ).toFixed(2)} MB，壓縮後: ${(outputStat.size / 1024 / 1024).toFixed(
        2
      )} MB，壓縮率: ${compressionRatio}%`
    )

    res.status(200).json({
      success: true,
      message: '檔案壓縮成功',
      data: {
        originalFile: objectName,
        compressedFile: compressedObjectName,
        bucketName: bucketName,
        processingTimeMs: processingTime,
        originalSize: inputStat.size,
        compressedSize: outputStat.size,
        compressionRatio: parseFloat(compressionRatio),
      },
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('❌ 壓縮過程發生錯誤:', error.message)

    // 確保清理暫存檔案
    try {
      await fs.unlink(inputPath).catch(() => {})
      await fs.unlink(outputPath).catch(() => {})
    } catch (cleanupError) {
      console.error('⚠️ 錯誤處理時清理檔案失敗:', cleanupError.message)
    }

    // 返回錯誤信息
    let errorMessage = '檔案壓縮失敗'
    if (error.message.includes('MinIO 下載錯誤')) {
      errorMessage = '無法從儲存桶下載檔案'
    } else if (error.message.includes('FFmpeg')) {
      errorMessage = '視訊壓縮處理失敗'
    } else if (error.message.includes('上傳')) {
      errorMessage = '無法上傳壓縮後的檔案'
    }

    res.status(500).json({
      success: false,
      error: errorMessage,
      details: error.message,
      timestamp: new Date().toISOString(),
    })
  } finally {
    console.log('-------')
  }
})

const PORT = process.env.PORT || 8080

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 FFmpeg 壓縮服務已啟動`)
  console.log(`   - 監聽端口: ${PORT}`)
  console.log(`   - MinIO 端點: ${MINIO_ENDPOINT}:${MINIO_PORT}`)
  console.log(`   - SSL: ${MINIO_USE_SSL ? '啟用' : '停用'}`)
  console.log('   - 端點:')
  console.log('     GET  /health   - 健康檢查')
  console.log('     POST /compress - 壓縮服務')
})
