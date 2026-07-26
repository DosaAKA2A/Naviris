package com.estudiodeiris.cobalt

import org.schabi.newpipe.extractor.NewPipe
import org.schabi.newpipe.extractor.ServiceList
import org.schabi.newpipe.extractor.downloader.Downloader
import org.schabi.newpipe.extractor.downloader.Request
import org.schabi.newpipe.extractor.downloader.Response
import org.schabi.newpipe.extractor.localization.Localization
import org.schabi.newpipe.extractor.stream.DeliveryMethod
import org.schabi.newpipe.extractor.stream.StreamInfo
import java.io.DataOutputStream
import java.net.HttpURLConnection
import java.net.URL

/* Rat Tool para Android: extracción de streams EN EL DISPOSITIVO con
   NewPipeExtractor (yt-dlp/ffmpeg son binarios de escritorio y multiplicarían
   el peso del APK). Solo formatos progresivos —vídeo con audio en un único
   archivo— porque sin ffmpeg no hay merge: MP4 y audio M4A directos. */
object RatTool {

    data class Option(val label: String, val url: String, val fileExt: String, val res: Int)
    data class Info(val title: String, val options: List<Option>)

    private const val UA =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

    private class NavDownloader : Downloader() {
        override fun execute(request: Request): Response {
            val conn = URL(request.url()).openConnection() as HttpURLConnection
            conn.connectTimeout = 15000
            conn.readTimeout = 15000
            conn.requestMethod = request.httpMethod()
            conn.instanceFollowRedirects = true
            for ((k, values) in request.headers()) for (v in values) conn.addRequestProperty(k, v)
            if (conn.getRequestProperty("User-Agent") == null) conn.setRequestProperty("User-Agent", UA)
            request.dataToSend()?.let { body ->
                conn.doOutput = true
                DataOutputStream(conn.outputStream).use { it.write(body) }
            }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else (conn.errorStream ?: conn.inputStream)
            val body = stream?.bufferedReader()?.use { it.readText() } ?: ""
            return Response(code, conn.responseMessage, conn.headerFields, body, conn.url.toString())
        }
    }

    @Volatile
    private var ready = false

    private fun init() {
        if (!ready) synchronized(this) {
            if (!ready) {
                NewPipe.init(NavDownloader(), Localization("es", "ES"))
                ready = true
            }
        }
    }

    fun isYouTube(url: String?): Boolean =
        url != null && Regex("(youtube\\.com/(watch|shorts/|live/)|youtu\\.be/)").containsMatchIn(url)

    /** Llamar SIEMPRE en un hilo de fondo; lanza excepción si la extracción falla. */
    fun fetchYouTube(url: String): Info {
        init()
        val info = StreamInfo.getInfo(ServiceList.YouTube, url)
        val opts = ArrayList<Option>()
        for (s in info.videoStreams) { // muxed: vídeo+audio juntos, descarga directa
            if (s.deliveryMethod != DeliveryMethod.PROGRESSIVE_HTTP || !s.isUrl) continue
            val ext = s.format?.suffix ?: "mp4"
            val resNum = Regex("\\d+").find(s.getResolution())?.value?.toIntOrNull() ?: 0
            opts.add(Option("Vídeo ${s.getResolution()} · ${ext.uppercase()}", s.content, ext, resNum))
        }
        val dedup = opts.distinctBy { it.label }.sortedByDescending { it.res }.toMutableList()
        info.audioStreams
            .filter { it.deliveryMethod == DeliveryMethod.PROGRESSIVE_HTTP && it.isUrl }
            .maxByOrNull { it.averageBitrate }
            ?.let { a ->
                val ext = a.format?.suffix ?: "m4a"
                dedup.add(Option("Audio ${a.averageBitrate} kbps · ${ext.uppercase()}", a.content, ext, 0))
            }
        if (dedup.isEmpty()) throw IllegalStateException("sin formatos descargables")
        return Info(info.name ?: "video", dedup)
    }
}
