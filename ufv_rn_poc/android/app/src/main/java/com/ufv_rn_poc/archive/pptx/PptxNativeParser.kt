package com.ufv_rn_poc.archive.pptx

import android.util.Log
import android.util.LruCache
import org.w3c.dom.Document
import org.w3c.dom.Element
import org.w3c.dom.Node
import java.io.File
import java.io.InputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipFile
import javax.xml.parsers.DocumentBuilderFactory
import kotlin.math.max
import kotlin.math.min

/**
 * High-performance, offline-first OpenXML PPTX Parser.
 * Resolves slide hierarchy: Slide -> SlideLayout -> SlideMaster -> Theme.
 * Outputs normalized responsive coordinates (0.0 to 1.0) and rich styles.
 */
class PptxNativeParser(private val cacheDir: File) {

    companion object {
        private const val TAG = "PptxNativeParser"
        private const val EMU_PER_INCH = 914400.0
        private const val EMU_PER_POINT = 12700.0
        private const val DEFAULT_WIDTH_EMU = 12192000L   // 16:9 standard
        private const val DEFAULT_HEIGHT_EMU = 6858000L
    }

    // Presentation Session LRU Cache (caches metadata, themes, layouts across multiple calls)
    private val sessionCache = object : LruCache<String, PresentationSession>(5) {
        override fun entryRemoved(evicted: Boolean, key: String?, oldValue: PresentationSession?, newValue: PresentationSession?) {
            try {
                oldValue?.close()
            } catch (e: Exception) {
                Log.w(TAG, "Error closing session zip: ${e.message}")
            }
        }
    }

    data class PlaceholderKey(val type: String?, val idx: Int?)

    data class ShapeTransform(
        val x: Double,
        val y: Double,
        val w: Double,
        val h: Double,
        val rot: Double = 0.0,
        val flipH: Boolean = false,
        val flipV: Boolean = false
    )

    data class MasterStyleRule(
        val sizePt: Double? = null,
        val bold: Boolean? = null,
        val italic: Boolean? = null,
        val underline: Boolean? = null,
        val colorHex: String? = null,
        val fontFace: String? = null,
        val align: String? = null
    )

    data class LayoutShapeInfo(
        val phKey: PlaceholderKey?,
        val transform: ShapeTransform?,
        val fill: Map<String, Any?>?,
        val line: Map<String, Any?>?,
        val textStyleRule: MasterStyleRule?,
        val isPlaceholder: Boolean,
        val rawElement: Element?,
        val rels: Map<String, String>?
    )

    data class MasterData(
        val clrMap: Map<String, String>,
        val titleStyles: Map<Int, MasterStyleRule>,
        val bodyStyles: Map<Int, MasterStyleRule>,
        val otherStyles: Map<Int, MasterStyleRule>,
        val placeholders: Map<PlaceholderKey, LayoutShapeInfo>,
        val nonPlaceholderShapes: List<Map<String, Any?>>
    )

    data class LayoutData(
        val background: Map<String, Any?>?,
        val showMasterSp: Boolean,
        val placeholders: Map<PlaceholderKey, LayoutShapeInfo>,
        val nonPlaceholderShapes: List<Map<String, Any?>>
    )

    class PresentationSession(
        val file: File,
        val zip: ZipFile,
        val widthEMU: Long,
        val heightEMU: Long,
        val aspectRatio: Double,
        val slidePaths: List<String>,
        val clrScheme: Map<String, String>,
        val defaultClrMap: Map<String, String>,
        val fontMajor: String,
        val fontMinor: String
    ) {
        val masterDataCache = mutableMapOf<String, MasterData>()
        val layoutDataCache = mutableMapOf<String, LayoutData>()
        val slideJsonCache = LruCache<Int, Map<String, Any?>>(30)

        fun close() {
            try {
                zip.close()
            } catch (ignored: Exception) {}
        }
    }

    /**
     * Reads slide metadata (slide count, dimensions, aspect ratio).
     * Fast call: only parses presentation.xml and presentation.xml.rels.
     */
    @Synchronized
    fun getPptxMeta(filePath: String): Map<String, Any?> {
        val session = getOrCreateSession(filePath)
        return mapOf(
            "status" to "SUCCESS",
            "slideCount" to session.slidePaths.size,
            "widthEMU" to session.widthEMU.toDouble(),
            "heightEMU" to session.heightEMU.toDouble(),
            "aspectRatio" to session.aspectRatio
        )
    }

    /**
     * Parses a single slide by index (0-based).
     * Cached in LRU Cache.
     */
    @Synchronized
    fun getPptxSlide(filePath: String, slideIndex: Int): Map<String, Any?> {
        val session = getOrCreateSession(filePath)
        if (slideIndex < 0 || slideIndex >= session.slidePaths.size) {
            throw IllegalArgumentException("Invalid slide index $slideIndex. Total slides: ${session.slidePaths.size}")
        }

        val cached = session.slideJsonCache.get(slideIndex)
        if (cached != null) {
            return cached
        }

        val slidePath = session.slidePaths[slideIndex]
        val parsedSlide = parseSlideInternal(session, slideIndex, slidePath)
        session.slideJsonCache.put(slideIndex, parsedSlide)

        return parsedSlide
    }

    private fun getOrCreateSession(filePath: String): PresentationSession {
        val file = File(filePath)
        if (!file.exists()) {
            throw NoSuchFileException(file, reason = "PPTX presentation file does not exist")
        }

        // 0. Check first 8 bytes for Compound File Binary (CFB/OLE) format
        val headerBytes = ByteArray(8)
        java.io.FileInputStream(file).use { it.read(headerBytes) }
        val isCfb = headerBytes.size >= 8 &&
                (headerBytes[0].toInt() and 0xFF == 0xD0) &&
                (headerBytes[1].toInt() and 0xFF == 0xCF) &&
                (headerBytes[2].toInt() and 0xFF == 0x11) &&
                (headerBytes[3].toInt() and 0xFF == 0xE0) &&
                (headerBytes[4].toInt() and 0xFF == 0xA1) &&
                (headerBytes[5].toInt() and 0xFF == 0xB1) &&
                (headerBytes[6].toInt() and 0xFF == 0x1A) &&
                (headerBytes[7].toInt() and 0xFF == 0xE1)

        if (isCfb) {
            throw SecurityException("ENCRYPTED_OR_LEGACY: This file is password-protected or in legacy Office format (PPT/DOC/XLS).")
        }

        val cacheKey = "${file.absolutePath}_${file.lastModified()}"
        val existing = sessionCache.get(cacheKey)
        if (existing != null) {
            return existing
        }

        val zip = ZipFile(file)
        try {
            // Zip Bomb protection: Entry count cap
            if (zip.size() > 2500) {
                throw SecurityException("ZIP_BOMB_DETECTED: Presentation archive contains ${zip.size()} entries (exceeds 2500 cap)")
            }

            // Zip Bomb protection: Total uncompressed content size cap
            var totalUncompressedBytes = 0L
            val entriesEnum = zip.entries()
            while (entriesEnum.hasMoreElements()) {
                val entry = entriesEnum.nextElement()
                if (entry.size > 0) {
                    totalUncompressedBytes += entry.size
                    if (totalUncompressedBytes > 500L * 1024L * 1024L) {
                        throw SecurityException("ZIP_BOMB_DETECTED: Total uncompressed content exceeds 500MB safety limit")
                    }
                }
            }
            // 1. presentation.xml
            val presDoc = parseXmlEntry(zip, "ppt/presentation.xml")
                ?: throw IllegalStateException("Invalid PPTX: ppt/presentation.xml not found")

            val sldSz = presDoc.documentElement.findFirstChild("sldSz")
            val widthEMU = sldSz?.getAttribute("cx")?.toLongOrNull() ?: DEFAULT_WIDTH_EMU
            val heightEMU = sldSz?.getAttribute("cy")?.toLongOrNull() ?: DEFAULT_HEIGHT_EMU
            val aspectRatio = if (heightEMU > 0) widthEMU.toDouble() / heightEMU.toDouble() else 16.0 / 9.0

            // 2. presentation.xml.rels
            val presRels = parseRelsEntry(zip, "ppt/_rels/presentation.xml.rels")

            // 3. Slide order from <p:sldIdLst>
            val sldIdLst = presDoc.documentElement.findFirstChild("sldIdLst")
            val slidePaths = mutableListOf<String>()
            if (sldIdLst != null) {
                for (sldId in sldIdLst.findChildren("sldId")) {
                    val rId = sldId.getAttribute("r:id").ifEmpty { sldId.getAttribute("id") }
                    val target = presRels[rId]
                    if (!target.isNullOrEmpty()) {
                        val resolved = resolveTarget("ppt/presentation.xml", target)
                        slidePaths.add(resolved)
                    }
                }
            }

            // Fallback if sldIdLst was empty
            if (slidePaths.isEmpty()) {
                val entries = zip.entries()
                val detected = mutableListOf<String>()
                while (entries.hasMoreElements()) {
                    val name = entries.nextElement().name
                    if (name.matches(Regex("""^ppt/slides/slide\d+\.xml$"""))) {
                        detected.add(name)
                    }
                }
                detected.sortBy {
                    Regex("""slide(\d+)\.xml""").find(it)?.groupValues?.get(1)?.toIntOrNull() ?: 0
                }
                slidePaths.addAll(detected)
            }

            // 4. Parse Theme
            var clrScheme = mapOf<String, String>()
            var fontMajor = "Calibri Light"
            var fontMinor = "Calibri"

            val themeEntryName = "ppt/theme/theme1.xml"
            val themeDoc = parseXmlEntry(zip, themeEntryName)
            if (themeDoc != null) {
                val clrSchemeEl = themeDoc.documentElement.findFirstChild("clrScheme")
                if (clrSchemeEl != null) {
                    clrScheme = parseColorScheme(clrSchemeEl)
                }
                val fontSchemeEl = themeDoc.documentElement.findFirstChild("fontScheme")
                if (fontSchemeEl != null) {
                    val majLatin = fontSchemeEl.findFirstChild("majorFont")?.findFirstChild("latin")?.getAttribute("typeface")
                    if (!majLatin.isNullOrEmpty()) fontMajor = majLatin
                    val minLatin = fontSchemeEl.findFirstChild("minorFont")?.findFirstChild("latin")?.getAttribute("typeface")
                    if (!minLatin.isNullOrEmpty()) fontMinor = minLatin
                }
            }

            // Default color scheme fallbacks
            val defaultClrScheme = mutableMapOf(
                "dk1" to "#000000",
                "lt1" to "#FFFFFF",
                "dk2" to "#44546A",
                "lt2" to "#E7E6E6",
                "accent1" to "#4472C4",
                "accent2" to "#ED7D31",
                "accent3" to "#A5A5A5",
                "accent4" to "#FFC000",
                "accent5" to "#5B9BD5",
                "accent6" to "#70AD47",
                "hlink" to "#0563C1",
                "folHlink" to "#954F72"
            )
            defaultClrScheme.putAll(clrScheme)

            val defaultClrMap = mapOf(
                "bg1" to "lt1",
                "tx1" to "dk1",
                "bg2" to "lt2",
                "tx2" to "dk2",
                "accent1" to "accent1",
                "accent2" to "accent2",
                "accent3" to "accent3",
                "accent4" to "accent4",
                "accent5" to "accent5",
                "accent6" to "accent6",
                "hlink" to "hlink",
                "folHlink" to "folHlink"
            )

            val session = PresentationSession(
                file = file,
                zip = zip,
                widthEMU = widthEMU,
                heightEMU = heightEMU,
                aspectRatio = aspectRatio,
                slidePaths = slidePaths,
                clrScheme = defaultClrScheme,
                defaultClrMap = defaultClrMap,
                fontMajor = fontMajor,
                fontMinor = fontMinor
            )

            sessionCache.put(cacheKey, session)
            return session
        } catch (e: Exception) {
            try { zip.close() } catch (ignored: Exception) {}
            throw e
        }
    }

    private fun parseSlideInternal(
        session: PresentationSession,
        slideIndex: Int,
        slidePath: String
    ): Map<String, Any?> {
        val slideDoc = parseXmlEntry(session.zip, slidePath)
            ?: throw IllegalStateException("Could not read slide XML at $slidePath")

        val slideRelsPath = slidePath.replace("slides/", "slides/_rels/") + ".rels"
        val slideRels = parseRelsEntry(session.zip, slideRelsPath)

        // Find Slide Layout
        var layoutPath: String? = null
        for ((_, target) in slideRels) {
            if (target.contains("slideLayout")) {
                layoutPath = resolveTarget(slidePath, target)
                break
            }
        }

        val layoutData = if (layoutPath != null) getOrCreateLayout(session, layoutPath) else null

        // Background Resolution: Slide -> Layout -> Master -> Fallback
        val bgNode = slideDoc.documentElement.findFirstChild("cSld")?.findFirstChild("bg")
        var background = if (bgNode != null) {
            resolveBackground(bgNode, session.defaultClrMap, session.clrScheme, slidePath, slideRels, session)
        } else null

        if (background == null && layoutData?.background != null) {
            background = layoutData.background
        }

        if (background == null) {
            background = mapOf("type" to "solid", "color" to "#FFFFFF")
        }

        val showMasterSp = slideDoc.documentElement.findFirstChild("cSld")?.getAttribute("showMasterSp") != "0"
        val allElements = mutableListOf<Map<String, Any?>>()

        // 1. Non-placeholder shapes from Master (if allowed)
        if (showMasterSp && layoutData != null && layoutData.showMasterSp) {
            // Find Master path via layout
            val masterPath = findMasterPathForLayout(session, layoutPath)
            if (masterPath != null) {
                val masterData = getOrCreateMaster(session, masterPath)
                allElements.addAll(masterData.nonPlaceholderShapes)
            }
        }

        // 2. Non-placeholder shapes from Layout
        if (showMasterSp && layoutData != null) {
            allElements.addAll(layoutData.nonPlaceholderShapes)
        }

        // 3. Slide Shapes
        val spTree = slideDoc.documentElement.findFirstChild("cSld")?.findFirstChild("spTree")
        if (spTree != null) {
            val slideShapes = parseShapeTree(
                container = spTree,
                session = session,
                basePath = slidePath,
                rels = slideRels,
                layoutData = layoutData,
                masterData = if (layoutPath != null) {
                    val mPath = findMasterPathForLayout(session, layoutPath)
                    if (mPath != null) getOrCreateMaster(session, mPath) else null
                } else null,
                parentGroupTransform = null
            )
            allElements.addAll(slideShapes)
        }

        return mapOf(
            "index" to (slideIndex + 1),
            "width" to session.widthEMU.toDouble(),
            "height" to session.heightEMU.toDouble(),
            "aspectRatio" to session.aspectRatio,
            "background" to background,
            "elements" to allElements
        )
    }

    private fun findMasterPathForLayout(session: PresentationSession, layoutPath: String?): String? {
        if (layoutPath == null) return null
        val layoutRelsPath = layoutPath.replace("slideLayouts/", "slideLayouts/_rels/") + ".rels"
        val layoutRels = parseRelsEntry(session.zip, layoutRelsPath)
        for ((_, target) in layoutRels) {
            if (target.contains("slideMaster")) {
                return resolveTarget(layoutPath, target)
            }
        }
        return "ppt/slideMasters/slideMaster1.xml"
    }

    private fun getOrCreateMaster(session: PresentationSession, masterPath: String): MasterData {
        val cached = session.masterDataCache[masterPath]
        if (cached != null) return cached

        val masterDoc = parseXmlEntry(session.zip, masterPath)
        val masterRelsPath = masterPath.replace("slideMasters/", "slideMasters/_rels/") + ".rels"
        val masterRels = parseRelsEntry(session.zip, masterRelsPath)

        val clrMapEl = masterDoc?.documentElement?.findFirstChild("clrMap")
        val clrMap = mutableMapOf<String, String>()
        clrMap.putAll(session.defaultClrMap)
        if (clrMapEl != null) {
            val attrs = clrMapEl.attributes
            for (i in 0 until attrs.length) {
                val item = attrs.item(i)
                clrMap[item.nodeName] = item.nodeValue
            }
        }

        val titleStyles = mutableMapOf<Int, MasterStyleRule>()
        val bodyStyles = mutableMapOf<Int, MasterStyleRule>()
        val otherStyles = mutableMapOf<Int, MasterStyleRule>()

        val txStyles = masterDoc?.documentElement?.findFirstChild("txStyles")
        if (txStyles != null) {
            parseTextStyles(txStyles.findFirstChild("titleStyle"), titleStyles, clrMap, session)
            parseTextStyles(txStyles.findFirstChild("bodyStyle"), bodyStyles, clrMap, session)
            parseTextStyles(txStyles.findFirstChild("otherStyle"), otherStyles, clrMap, session)
        }

        val placeholders = mutableMapOf<PlaceholderKey, LayoutShapeInfo>()
        val nonPlaceholders = mutableListOf<Map<String, Any?>>()

        val spTree = masterDoc?.documentElement?.findFirstChild("cSld")?.findFirstChild("spTree")
        if (spTree != null) {
            for (child in spTree.findChildren()) {
                val localName = child.localNameOrName()
                if (localName !in listOf("sp", "pic", "grpSp", "graphicFrame")) continue

                val phKey = extractPlaceholderKey(child)
                if (phKey != null) {
                    val xfrm = extractTransform(child, session.widthEMU, session.heightEMU, null)
                    val fill = extractFill(child, clrMap, session.clrScheme)
                    val line = extractLine(child, clrMap, session.clrScheme)
                    placeholders[phKey] = LayoutShapeInfo(
                        phKey = phKey,
                        transform = xfrm,
                        fill = fill,
                        line = line,
                        textStyleRule = null,
                        isPlaceholder = true,
                        rawElement = child,
                        rels = masterRels
                    )
                } else {
                    // Non-placeholder master art (logo, header line, decorative shape)
                    try {
                        val parsed = parseSingleElement(
                            elem = child,
                            session = session,
                            basePath = masterPath,
                            rels = masterRels,
                            layoutData = null,
                            masterData = null,
                            parentGroupTransform = null
                        )
                        if (parsed != null) nonPlaceholders.add(parsed)
                    } catch (e: Exception) {
                        Log.w(TAG, "Skipping bad master shape: ${e.message}")
                    }
                }
            }
        }

        val masterData = MasterData(
            clrMap = clrMap,
            titleStyles = titleStyles,
            bodyStyles = bodyStyles,
            otherStyles = otherStyles,
            placeholders = placeholders,
            nonPlaceholderShapes = nonPlaceholders
        )
        session.masterDataCache[masterPath] = masterData
        return masterData
    }

    private fun getOrCreateLayout(session: PresentationSession, layoutPath: String): LayoutData {
        val cached = session.layoutDataCache[layoutPath]
        if (cached != null) return cached

        val layoutDoc = parseXmlEntry(session.zip, layoutPath)
        val layoutRelsPath = layoutPath.replace("slideLayouts/", "slideLayouts/_rels/") + ".rels"
        val layoutRels = parseRelsEntry(session.zip, layoutRelsPath)

        val masterPath = findMasterPathForLayout(session, layoutPath)
        val masterData = if (masterPath != null) getOrCreateMaster(session, masterPath) else null
        val clrMap = masterData?.clrMap ?: session.defaultClrMap

        val bgNode = layoutDoc?.documentElement?.findFirstChild("cSld")?.findFirstChild("bg")
        val background = if (bgNode != null) {
            resolveBackground(bgNode, clrMap, session.clrScheme, layoutPath, layoutRels, session)
        } else null

        val showMasterSp = layoutDoc?.documentElement?.findFirstChild("cSld")?.getAttribute("showMasterSp") != "0"

        val placeholders = mutableMapOf<PlaceholderKey, LayoutShapeInfo>()
        val nonPlaceholders = mutableListOf<Map<String, Any?>>()

        val spTree = layoutDoc?.documentElement?.findFirstChild("cSld")?.findFirstChild("spTree")
        if (spTree != null) {
            for (child in spTree.findChildren()) {
                val localName = child.localNameOrName()
                if (localName !in listOf("sp", "pic", "grpSp", "graphicFrame")) continue

                val phKey = extractPlaceholderKey(child)
                if (phKey != null) {
                    val xfrm = extractTransform(child, session.widthEMU, session.heightEMU, null)
                    val fill = extractFill(child, clrMap, session.clrScheme)
                    val line = extractLine(child, clrMap, session.clrScheme)
                    placeholders[phKey] = LayoutShapeInfo(
                        phKey = phKey,
                        transform = xfrm,
                        fill = fill,
                        line = line,
                        textStyleRule = null,
                        isPlaceholder = true,
                        rawElement = child,
                        rels = layoutRels
                    )
                } else {
                    // Non-placeholder layout art
                    try {
                        val parsed = parseSingleElement(
                            elem = child,
                            session = session,
                            basePath = layoutPath,
                            rels = layoutRels,
                            layoutData = null,
                            masterData = masterData,
                            parentGroupTransform = null
                        )
                        if (parsed != null) nonPlaceholders.add(parsed)
                    } catch (e: Exception) {
                        Log.w(TAG, "Skipping bad layout shape: ${e.message}")
                    }
                }
            }
        }

        val layoutData = LayoutData(
            background = background,
            showMasterSp = showMasterSp,
            placeholders = placeholders,
            nonPlaceholderShapes = nonPlaceholders
        )
        session.layoutDataCache[layoutPath] = layoutData
        return layoutData
    }

    private fun parseShapeTree(
        container: Element,
        session: PresentationSession,
        basePath: String,
        rels: Map<String, String>,
        layoutData: LayoutData?,
        masterData: MasterData?,
        parentGroupTransform: ShapeTransform?
    ): List<Map<String, Any?>> {
        val elements = mutableListOf<Map<String, Any?>>()

        for (child in container.findChildren()) {
            val localName = child.localNameOrName()
            if (localName !in listOf("sp", "pic", "grpSp", "graphicFrame", "cxnSp")) continue

            try {
                if (localName == "grpSp") {
                    val groupTransform = extractGroupTransform(child, session.widthEMU, session.heightEMU, parentGroupTransform)
                    // Traverse inner shapes inside grpSp
                    val innerShapes = parseShapeTree(
                        container = child,
                        session = session,
                        basePath = basePath,
                        rels = rels,
                        layoutData = layoutData,
                        masterData = masterData,
                        parentGroupTransform = groupTransform
                    )
                    elements.addAll(innerShapes)
                } else {
                    val parsed = parseSingleElement(
                        elem = child,
                        session = session,
                        basePath = basePath,
                        rels = rels,
                        layoutData = layoutData,
                        masterData = masterData,
                        parentGroupTransform = parentGroupTransform
                    )
                    if (parsed != null) {
                        elements.add(parsed)
                    }
                }
            } catch (t: Throwable) {
                Log.w(TAG, "Error parsing shape <$localName> in $basePath: ${t.message}", t)
            }
        }

        return elements
    }

    private fun parseSingleElement(
        elem: Element,
        session: PresentationSession,
        basePath: String,
        rels: Map<String, String>,
        layoutData: LayoutData?,
        masterData: MasterData?,
        parentGroupTransform: ShapeTransform?
    ): Map<String, Any?>? {
        val localName = elem.localNameOrName()
        val clrMap = masterData?.clrMap ?: session.defaultClrMap
        val phKey = extractPlaceholderKey(elem)

        // 1. Resolve Transform
        var transform = extractTransform(elem, session.widthEMU, session.heightEMU, parentGroupTransform)

        // If transform missing and placeholder exists, inherit from layout or master
        if (transform == null && phKey != null) {
            val layoutPh = matchPlaceholder(phKey, layoutData?.placeholders)
            if (layoutPh?.transform != null) {
                transform = layoutPh.transform
            } else {
                val masterPh = matchPlaceholder(phKey, masterData?.placeholders)
                if (masterPh?.transform != null) {
                    transform = masterPh.transform
                }
            }
        }

        // Default transform if still null
        if (transform == null) {
            transform = getFallbackTransform(phKey)
        }

        // 2. Shape Geometry
        val prstGeom = elem.findFirstChild("spPr")?.findFirstChild("prstGeom")?.getAttribute("prst") ?: "rect"

        // 3. Fill & Line
        var fill = extractFill(elem, clrMap, session.clrScheme)
        var line = extractLine(elem, clrMap, session.clrScheme)

        if (fill == null && phKey != null) {
            val layoutPh = matchPlaceholder(phKey, layoutData?.placeholders)
            fill = layoutPh?.fill ?: matchPlaceholder(phKey, masterData?.placeholders)?.fill
        }

        if (line == null && phKey != null) {
            val layoutPh = matchPlaceholder(phKey, layoutData?.placeholders)
            line = layoutPh?.line ?: matchPlaceholder(phKey, masterData?.placeholders)?.line
        }

        // 4. Handle Element by Type
        when (localName) {
            "pic" -> {
                val blip = elem.findFirstChild("blipFill")?.findFirstChild("blip")
                val rEmbed = blip?.getAttribute("r:embed") ?: blip?.getAttribute("embed")
                var imageUri: String? = null
                if (!rEmbed.isNullOrEmpty() && rels.containsKey(rEmbed)) {
                    val target = rels[rEmbed]!!
                    val fullPath = resolveTarget(basePath, target)
                    imageUri = extractMediaImage(session.zip, fullPath, session.file.nameWithoutExtension)
                }

                // Crop
                val srcRect = elem.findFirstChild("blipFill")?.findFirstChild("srcRect")
                val cropMap = if (srcRect != null) {
                    mapOf(
                        "left" to (srcRect.getAttribute("l").toDoubleOrNull() ?: 0.0) / 100000.0,
                        "top" to (srcRect.getAttribute("t").toDoubleOrNull() ?: 0.0) / 100000.0,
                        "right" to (srcRect.getAttribute("r").toDoubleOrNull() ?: 0.0) / 100000.0,
                        "bottom" to (srcRect.getAttribute("b").toDoubleOrNull() ?: 0.0) / 100000.0
                    )
                } else null

                return mapOf(
                    "type" to "image",
                    "x" to transform.x,
                    "y" to transform.y,
                    "w" to transform.w,
                    "h" to transform.h,
                    "rotation" to transform.rot,
                    "flipH" to transform.flipH,
                    "flipV" to transform.flipV,
                    "geometry" to prstGeom,
                    "imageUri" to imageUri,
                    "crop" to cropMap
                )
            }

            "sp", "cxnSp" -> {
                val txBody = elem.findFirstChild("txBody")
                val bodyPr = txBody?.findFirstChild("bodyPr")
                val anchor = when (bodyPr?.getAttribute("anchor")) {
                    "ctr" -> "middle"
                    "b" -> "bottom"
                    else -> "top"
                }

                val normAutofit = bodyPr?.findFirstChild("normAutofit")
                val autofitMap = if (normAutofit != null) {
                    mapOf(
                        "fontScale" to (normAutofit.getAttribute("fontScale").toDoubleOrNull() ?: 100000.0) / 100000.0,
                        "lnSpcReduction" to (normAutofit.getAttribute("lnSpcReduction").toDoubleOrNull() ?: 0.0) / 100000.0
                    )
                } else null

                val paragraphs = mutableListOf<Map<String, Any?>>()
                if (txBody != null) {
                    val pNodes = txBody.findChildren("p")
                    for (p in pNodes) {
                        val pPr = p.findFirstChild("pPr")
                        val lvl = pPr?.getAttribute("lvl")?.toIntOrNull() ?: 0
                        val rawAlgn = pPr?.getAttribute("algn")
                        val align = when (rawAlgn) {
                            "ctr" -> "center"
                            "r" -> "right"
                            "just" -> "justify"
                            else -> if (phKey?.type in listOf("title", "ctrTitle")) "center" else "left"
                        }

                        // Bullets
                        var bullet: String? = null
                        if (pPr?.findFirstChild("buNone") == null) {
                            val buChar = pPr?.findFirstChild("buChar")?.getAttribute("char")
                            if (!buChar.isNullOrEmpty()) {
                                bullet = buChar
                            } else if (pPr?.findFirstChild("buAutoNum") != null) {
                                bullet = "auto"
                            } else if (lvl > 0 || phKey?.type == "body") {
                                bullet = "•"
                            }
                        }

                        val runs = mutableListOf<Map<String, Any?>>()
                        for (runOrField in p.findChildren()) {
                            val rLocalName = runOrField.localNameOrName()
                            if (rLocalName !in listOf("r", "fld")) continue

                            val text = runOrField.findFirstChild("t")?.textContent ?: ""
                            if (text.isEmpty()) continue

                            val rPr = runOrField.findFirstChild("rPr")

                            // Resolve Run Attributes with Style Inheritance
                            val sizePt = (rPr?.getAttribute("sz")?.toDoubleOrNull()?.div(100.0))
                                ?: getInheritedStyle(phKey, lvl, masterData)?.sizePt
                                ?: if (phKey?.type in listOf("title", "ctrTitle")) 36.0 else 18.0

                            val bold = rPr?.getAttribute("b")?.let { it == "1" || it == "true" }
                                ?: getInheritedStyle(phKey, lvl, masterData)?.bold
                                ?: (phKey?.type in listOf("title", "ctrTitle"))

                            val italic = rPr?.getAttribute("i")?.let { it == "1" || it == "true" }
                                ?: getInheritedStyle(phKey, lvl, masterData)?.italic
                                ?: false

                            val underline = rPr?.getAttribute("u")?.let { it.isNotEmpty() && it != "none" }
                                ?: getInheritedStyle(phKey, lvl, masterData)?.underline
                                ?: false

                            val colorHex = resolveColorFromContainer(rPr, clrMap, session.clrScheme)
                                ?: getInheritedStyle(phKey, lvl, masterData)?.colorHex
                                ?: "#000000"

                            val fontFace = resolveFont(rPr, session)
                                ?: getInheritedStyle(phKey, lvl, masterData)?.fontFace
                                ?: session.fontMinor

                            runs.add(
                                mapOf(
                                    "text" to text,
                                    "sizePt" to sizePt,
                                    "bold" to bold,
                                    "italic" to italic,
                                    "underline" to underline,
                                    "color" to colorHex,
                                    "font" to fontFace
                                )
                            )
                        }

                        if (runs.isNotEmpty()) {
                            paragraphs.add(
                                mapOf(
                                    "align" to align,
                                    "bullet" to bullet,
                                    "level" to lvl,
                                    "runs" to runs
                                )
                            )
                        }
                    }
                }

                val isTextShape = paragraphs.isNotEmpty()
                return mapOf(
                    "type" to (if (isTextShape) "text" else "shape"),
                    "x" to transform.x,
                    "y" to transform.y,
                    "w" to transform.w,
                    "h" to transform.h,
                    "rotation" to transform.rot,
                    "flipH" to transform.flipH,
                    "flipV" to transform.flipV,
                    "geometry" to prstGeom,
                    "anchor" to anchor,
                    "fill" to fill,
                    "line" to line,
                    "autofit" to autofitMap,
                    "paragraphs" to (if (isTextShape) paragraphs else null)
                )
            }

            "graphicFrame" -> {
                val graphicData = elem.findFirstChild("graphic")?.findFirstChild("graphicData")
                val tbl = graphicData?.findFirstChild("tbl")
                if (tbl != null) {
                    val tableData = parseTable(tbl, clrMap, session.clrScheme, session)
                    return mapOf(
                        "type" to "table",
                        "x" to transform.x,
                        "y" to transform.y,
                        "w" to transform.w,
                        "h" to transform.h,
                        "table" to tableData
                    )
                } else {
                    val uri = graphicData?.getAttribute("uri") ?: ""
                    val kind = when {
                        uri.contains("chart") -> "chart"
                        uri.contains("diagram") -> "diagram"
                        else -> "graphic"
                    }
                    return mapOf(
                        "type" to "unsupported",
                        "kind" to kind,
                        "x" to transform.x,
                        "y" to transform.y,
                        "w" to transform.w,
                        "h" to transform.h
                    )
                }
            }

            else -> return null
        }
    }

    private fun parseTable(
        tbl: Element,
        clrMap: Map<String, String>,
        clrScheme: Map<String, String>,
        session: PresentationSession
    ): Map<String, Any?> {
        val rows = mutableListOf<List<Map<String, Any?>>>()
        for (tr in tbl.findChildren("tr")) {
            val rowCells = mutableListOf<Map<String, Any?>>()
            for (tc in tr.findChildren("tc")) {
                val tcPr = tc.findFirstChild("tcPr")
                val cellFill = extractFill(tcPr, clrMap, clrScheme)
                val textRuns = mutableListOf<String>()
                val txBody = tc.findFirstChild("txBody")
                if (txBody != null) {
                    for (p in txBody.findChildren("p")) {
                        for (r in p.findChildren("r")) {
                            val t = r.findFirstChild("t")?.textContent
                            if (!t.isNullOrEmpty()) textRuns.add(t)
                        }
                    }
                }
                rowCells.add(
                    mapOf(
                        "text" to textRuns.joinToString(" "),
                        "fill" to (cellFill?.get("color") ?: "#FFFFFF")
                    )
                )
            }
            if (rowCells.isNotEmpty()) rows.add(rowCells)
        }
        return mapOf("rows" to rows)
    }

    private fun extractTransform(
        elem: Element,
        widthEMU: Long,
        heightEMU: Long,
        parentGroupTransform: ShapeTransform?
    ): ShapeTransform? {
        val xfrm = elem.findFirstChild("spPr")?.findFirstChild("xfrm")
            ?: elem.findFirstChild("xfrm")
            ?: return null

        val off = xfrm.findFirstChild("off")
        val ext = xfrm.findFirstChild("ext")
        if (off == null || ext == null) return null

        val rawX = off.getAttribute("x").toDoubleOrNull() ?: 0.0
        val rawY = off.getAttribute("y").toDoubleOrNull() ?: 0.0
        val rawW = ext.getAttribute("cx").toDoubleOrNull() ?: 0.0
        val rawH = ext.getAttribute("cy").toDoubleOrNull() ?: 0.0

        val rot = (xfrm.getAttribute("rot").toDoubleOrNull() ?: 0.0) / 60000.0
        val flipH = xfrm.getAttribute("flipH") == "1"
        val flipV = xfrm.getAttribute("flipV") == "1"

        // If child of a group shape, parent coordinates are mapped
        var x = rawX / widthEMU.toDouble()
        var y = rawY / heightEMU.toDouble()
        var w = rawW / widthEMU.toDouble()
        var h = rawH / heightEMU.toDouble()

        if (parentGroupTransform != null) {
            x = parentGroupTransform.x + (x * parentGroupTransform.w)
            y = parentGroupTransform.y + (y * parentGroupTransform.h)
            w *= parentGroupTransform.w
            h *= parentGroupTransform.h
        }

        // Clamp to valid range and avoid NaN/negative
        x = max(0.0, min(1.0, if (x.isNaN()) 0.0 else x))
        y = max(0.0, min(1.0, if (y.isNaN()) 0.0 else y))
        w = max(0.001, min(1.0, if (w.isNaN()) 0.1 else w))
        h = max(0.001, min(1.0, if (h.isNaN()) 0.1 else h))

        return ShapeTransform(
            x = (x * 10000).toInt() / 10000.0,
            y = (y * 10000).toInt() / 10000.0,
            w = (w * 10000).toInt() / 10000.0,
            h = (h * 10000).toInt() / 10000.0,
            rot = rot,
            flipH = flipH,
            flipV = flipV
        )
    }

    private fun extractGroupTransform(
        elem: Element,
        widthEMU: Long,
        heightEMU: Long,
        parentGroupTransform: ShapeTransform?
    ): ShapeTransform? {
        val grpSpPr = elem.findFirstChild("grpSpPr")
        val xfrm = grpSpPr?.findFirstChild("xfrm") ?: return parentGroupTransform

        val off = xfrm.findFirstChild("off")
        val ext = xfrm.findFirstChild("ext")
        val chOff = xfrm.findFirstChild("chOff")
        val chExt = xfrm.findFirstChild("chExt")

        val gx = (off?.getAttribute("x")?.toDoubleOrNull() ?: 0.0) / widthEMU.toDouble()
        val gy = (off?.getAttribute("y")?.toDoubleOrNull() ?: 0.0) / heightEMU.toDouble()
        val gw = (ext?.getAttribute("cx")?.toDoubleOrNull() ?: widthEMU.toDouble()) / widthEMU.toDouble()
        val gh = (ext?.getAttribute("cy")?.toDoubleOrNull() ?: heightEMU.toDouble()) / heightEMU.toDouble()

        var transform = ShapeTransform(x = gx, y = gy, w = gw, h = gh)
        if (parentGroupTransform != null) {
            transform = ShapeTransform(
                x = parentGroupTransform.x + (gx * parentGroupTransform.w),
                y = parentGroupTransform.y + (gy * parentGroupTransform.h),
                w = gw * parentGroupTransform.w,
                h = gh * parentGroupTransform.h
            )
        }
        return transform
    }

    private fun extractFill(elem: Element?, clrMap: Map<String, String>, clrScheme: Map<String, String>): Map<String, Any?>? {
        val spPr = if (elem?.localNameOrName() == "spPr" || elem?.localNameOrName() == "tcPr") elem else elem?.findFirstChild("spPr") ?: elem
        if (spPr?.findFirstChild("noFill") != null) {
            return mapOf("type" to "none")
        }
        val solidFill = spPr?.findFirstChild("solidFill")
        if (solidFill != null) {
            val color = resolveColorFromContainer(solidFill, clrMap, clrScheme)
            if (color != null) {
                return mapOf("type" to "solid", "color" to color)
            }
        }
        val gradFill = spPr?.findFirstChild("gradFill")
        if (gradFill != null) {
            val stops = mutableListOf<Map<String, Any>>()
            for (gs in gradFill.findFirstChild("gsLst")?.findChildren("gs") ?: emptyList()) {
                val pos = (gs.getAttribute("pos").toDoubleOrNull() ?: 0.0) / 100000.0
                val color = resolveColorFromContainer(gs, clrMap, clrScheme) ?: "#FFFFFF"
                stops.add(mapOf("pos" to pos, "color" to color))
            }
            val ang = (gradFill.findFirstChild("lin")?.getAttribute("ang")?.toDoubleOrNull() ?: 0.0) / 60000.0
            return mapOf("type" to "gradient", "stops" to stops, "angle" to ang)
        }
        return null
    }

    private fun extractLine(elem: Element?, clrMap: Map<String, String>, clrScheme: Map<String, String>): Map<String, Any?>? {
        val spPr = if (elem?.localNameOrName() == "spPr") elem else elem?.findFirstChild("spPr") ?: elem
        val ln = spPr?.findFirstChild("ln") ?: return null
        if (ln.findFirstChild("noFill") != null) return null

        // Only return a line if an explicit color is resolved under ln (prevents phantom black borders on text shapes)
        val color = resolveColorFromContainer(ln, clrMap, clrScheme) ?: return null
        val wEMU = ln.getAttribute("w").toDoubleOrNull() ?: EMU_PER_POINT
        val widthPt = max(0.5, wEMU / EMU_PER_POINT)

        return mapOf(
            "width" to widthPt,
            "color" to color
        )
    }

    private fun resolveBackground(
        bgNode: Element,
        clrMap: Map<String, String>,
        clrScheme: Map<String, String>,
        basePath: String,
        rels: Map<String, String>,
        session: PresentationSession
    ): Map<String, Any?>? {
        val bgPr = bgNode.findFirstChild("bgPr") ?: bgNode
        val solidFill = bgPr.findFirstChild("solidFill")
        if (solidFill != null) {
            val c = resolveColorFromContainer(solidFill, clrMap, clrScheme)
            if (c != null) return mapOf("type" to "solid", "color" to c)
        }
        val gradFill = bgPr.findFirstChild("gradFill")
        if (gradFill != null) {
            val stops = mutableListOf<Map<String, Any>>()
            for (gs in gradFill.findFirstChild("gsLst")?.findChildren("gs") ?: emptyList()) {
                val pos = (gs.getAttribute("pos").toDoubleOrNull() ?: 0.0) / 100000.0
                val c = resolveColorFromContainer(gs, clrMap, clrScheme) ?: "#FFFFFF"
                stops.add(mapOf("pos" to pos, "color" to c))
            }
            val ang = (gradFill.findFirstChild("lin")?.getAttribute("ang")?.toDoubleOrNull() ?: 0.0) / 60000.0
            return mapOf("type" to "gradient", "stops" to stops, "angle" to ang)
        }
        val blipFill = bgPr.findFirstChild("blipFill")
        if (blipFill != null) {
            val rEmbed = blipFill.findFirstChild("blip")?.getAttribute("r:embed")
            if (!rEmbed.isNullOrEmpty() && rels.containsKey(rEmbed)) {
                val fullPath = resolveTarget(basePath, rels[rEmbed]!!)
                val uri = extractMediaImage(session.zip, fullPath, session.file.nameWithoutExtension)
                return mapOf("type" to "image", "imageUri" to uri)
            }
        }
        val bgRef = bgNode.findFirstChild("bgRef")
        if (bgRef != null) {
            val c = resolveColorFromContainer(bgRef, clrMap, clrScheme)
            if (c != null) return mapOf("type" to "solid", "color" to c)
        }
        return null
    }

    private fun resolveColorFromContainer(
        container: Element?,
        clrMap: Map<String, String>,
        clrScheme: Map<String, String>
    ): String? {
        if (container == null) return null

        var colorNode: Element? = null
        var rawHex: String? = null

        val srgb = container.findFirstChildRecursive("srgbClr")
        if (srgb != null) {
            colorNode = srgb
            rawHex = "#" + srgb.getAttribute("val")
        } else {
            val scheme = container.findFirstChildRecursive("schemeClr")
            if (scheme != null) {
                colorNode = scheme
                val valAttr = scheme.getAttribute("val")
                val mapped = clrMap[valAttr] ?: valAttr
                rawHex = clrScheme[mapped] ?: clrScheme[valAttr] ?: "#000000"
            } else {
                val sys = container.findFirstChildRecursive("sysClr")
                if (sys != null) {
                    colorNode = sys
                    val lastClr = sys.getAttribute("lastClr")
                    rawHex = if (lastClr.isNotEmpty()) "#$lastClr" else if (sys.getAttribute("val").contains("Text", true)) "#000000" else "#FFFFFF"
                } else {
                    val prst = container.findFirstChildRecursive("prstClr")
                    if (prst != null) {
                        colorNode = prst
                        rawHex = resolvePresetColor(prst.getAttribute("val"))
                    }
                }
            }
        }

        if (rawHex == null || !rawHex.matches(Regex("""^#[0-9a-fA-F]{6}$"""))) {
            return rawHex
        }

        // Apply Color Modifiers (lumMod, lumOff, tint, shade)
        if (colorNode != null) {
            try {
                var r = rawHex.substring(1, 3).toInt(16)
                var g = rawHex.substring(3, 5).toInt(16)
                var b = rawHex.substring(5, 7).toInt(16)

                val tint = colorNode.findFirstChild("tint")?.getAttribute("val")?.toDoubleOrNull()?.div(100000.0)
                if (tint != null) {
                    r = (r * tint + 255.0 * (1.0 - tint)).toInt()
                    g = (g * tint + 255.0 * (1.0 - tint)).toInt()
                    b = (b * tint + 255.0 * (1.0 - tint)).toInt()
                }

                val shade = colorNode.findFirstChild("shade")?.getAttribute("val")?.toDoubleOrNull()?.div(100000.0)
                if (shade != null) {
                    r = (r * shade).toInt()
                    g = (g * shade).toInt()
                    b = (b * shade).toInt()
                }

                val lumMod = colorNode.findFirstChild("lumMod")?.getAttribute("val")?.toDoubleOrNull()?.div(100000.0)
                val lumOff = colorNode.findFirstChild("lumOff")?.getAttribute("val")?.toDoubleOrNull()?.div(100000.0)

                if (lumMod != null || lumOff != null) {
                    val hsv = FloatArray(3)
                    android.graphics.Color.RGBToHSV(r, g, b, hsv)
                    var v = hsv[2]
                    if (lumMod != null) v *= lumMod.toFloat()
                    if (lumOff != null) v = min(1.0f, v + lumOff.toFloat())
                    hsv[2] = max(0.0f, min(1.0f, v))
                    val adjustedRgb = android.graphics.Color.HSVToColor(hsv)
                    r = android.graphics.Color.red(adjustedRgb)
                    g = android.graphics.Color.green(adjustedRgb)
                    b = android.graphics.Color.blue(adjustedRgb)
                }

                r = max(0, min(255, r))
                g = max(0, min(255, g))
                b = max(0, min(255, b))
                return String.format("#%02X%02X%02X", r, g, b)
            } catch (e: Exception) {
                return rawHex
            }
        }

        return rawHex
    }

    private fun resolvePresetColor(valStr: String): String {
        return when (valStr.lowercase()) {
            "black" -> "#000000"
            "white" -> "#FFFFFF"
            "red" -> "#FF0000"
            "green" -> "#008000"
            "blue" -> "#0000FF"
            "yellow" -> "#FFFF00"
            "gray", "grey" -> "#808080"
            "silver" -> "#C0C0C0"
            "maroon" -> "#800000"
            "purple" -> "#800080"
            "fuchsia" -> "#FF00FF"
            "lime" -> "#00FF00"
            "olive" -> "#808000"
            "navy" -> "#000080"
            "teal" -> "#008080"
            "aqua" -> "#00FFFF"
            "orange" -> "#FFA500"
            else -> "#000000"
        }
    }

    private fun resolveFont(rPr: Element?, session: PresentationSession): String? {
        val latin = rPr?.findFirstChild("latin")?.getAttribute("typeface")
        if (!latin.isNullOrEmpty()) {
            return when (latin) {
                "+mj-lt", "+mj-ea", "+mj-cs" -> session.fontMajor
                "+mn-lt", "+mn-ea", "+mn-cs" -> session.fontMinor
                else -> latin
            }
        }
        return null
    }

    private fun extractMediaImage(zip: ZipFile, targetPath: String, deckPrefix: String): String {
        val mediaDir = File(cacheDir, "pptx_media")
        if (!mediaDir.exists()) mediaDir.mkdirs()

        val cleanDeckPrefix = deckPrefix.replace(Regex("[\\\\/:*?\"<>|]"), "_")
        val cleanName = File(targetPath).name.replace(Regex("[\\\\/:*?\"<>|]"), "_")
        val destFile = File(mediaDir, "${cleanDeckPrefix}_${cleanName}")

        // Zip-slip guard: ensure target file cannot escape media directory
        if (!destFile.canonicalPath.startsWith(mediaDir.canonicalPath)) {
            throw SecurityException("ZIP_SLIP_DETECTED: Path traversal attempt in entry: $targetPath")
        }

        if (!destFile.exists() || destFile.length() == 0L) {
            val entry = zip.getEntry(targetPath) ?: zip.getEntry(targetPath.removePrefix("/"))
            if (entry != null) {
                // Zip-bomb guard: per-media size cap (100MB)
                if (entry.size > 100L * 1024L * 1024L) {
                    throw SecurityException("ZIP_BOMB_DETECTED: Media entry exceeds 100MB safety limit: ${entry.size} bytes")
                }
                zip.getInputStream(entry).use { input ->
                    destFile.outputStream().use { output ->
                        input.copyTo(output)
                    }
                }
            }
        }
        return "file://${destFile.absolutePath}"
    }

    private fun extractPlaceholderKey(elem: Element): PlaceholderKey? {
        val nvPr = elem.findFirstChild("nvSpPr")?.findFirstChild("nvPr")
            ?: elem.findFirstChild("nvPicPr")?.findFirstChild("nvPr")
            ?: elem.findFirstChild("nvGraphicFramePr")?.findFirstChild("nvPr")
            ?: return null

        val ph = nvPr.findFirstChild("ph") ?: return null
        val type = ph.getAttribute("type").ifEmpty { null }
        val idx = ph.getAttribute("idx").toIntOrNull()
        return PlaceholderKey(type, idx)
    }

    private fun matchPlaceholder(key: PlaceholderKey, placeholders: Map<PlaceholderKey, LayoutShapeInfo>?): LayoutShapeInfo? {
        if (placeholders.isNullOrEmpty()) return null

        // 1. Exact match (type and idx)
        placeholders[key]?.let { return it }

        // 2. Match by type if idx doesn't match
        if (key.type != null) {
            for ((k, v) in placeholders) {
                if (k.type == key.type) return v
            }
            // Title alias match
            if (key.type == "title") {
                for ((k, v) in placeholders) {
                    if (k.type == "ctrTitle") return v
                }
            } else if (key.type == "ctrTitle") {
                for ((k, v) in placeholders) {
                    if (k.type == "title") return v
                }
            }
        }

        // 3. Fallback body match
        if (key.type == null || key.type == "body") {
            for ((k, v) in placeholders) {
                if (k.type == "body" || k.type == null) return v
            }
        }

        return null
    }

    private fun getInheritedStyle(phKey: PlaceholderKey?, lvl: Int, masterData: MasterData?): MasterStyleRule? {
        if (masterData == null) return null
        val clampedLvl = max(0, min(8, lvl))
        return when (phKey?.type) {
            "title", "ctrTitle", "subTitle" -> masterData.titleStyles[clampedLvl] ?: masterData.titleStyles[0]
            "body" -> masterData.bodyStyles[clampedLvl] ?: masterData.bodyStyles[0]
            else -> masterData.otherStyles[clampedLvl] ?: masterData.bodyStyles[clampedLvl]
        }
    }

    private fun parseTextStyles(
        styleNode: Element?,
        outMap: MutableMap<Int, MasterStyleRule>,
        clrMap: Map<String, String>,
        session: PresentationSession
    ) {
        if (styleNode == null) return
        for (i in 1..9) {
            val lvlNode = styleNode.findFirstChild("lvl${i}pPr") ?: continue
            val defRPr = lvlNode.findFirstChild("defRPr")

            val sz = defRPr?.getAttribute("sz")?.toDoubleOrNull()?.div(100.0)
            val b = defRPr?.getAttribute("b")?.let { it == "1" || it == "true" }
            val it = defRPr?.getAttribute("i")?.let { it == "1" || it == "true" }
            val u = defRPr?.getAttribute("u")?.let { it.isNotEmpty() && it != "none" }
            val color = resolveColorFromContainer(defRPr, clrMap, session.clrScheme)
            val font = resolveFont(defRPr, session)

            outMap[i - 1] = MasterStyleRule(
                sizePt = sz,
                bold = b,
                italic = it,
                underline = u,
                colorHex = color,
                fontFace = font
            )
        }
    }

    private fun getFallbackTransform(phKey: PlaceholderKey?): ShapeTransform {
        return when (phKey?.type) {
            "title", "ctrTitle" -> ShapeTransform(x = 0.05, y = 0.08, w = 0.90, h = 0.18)
            "subTitle" -> ShapeTransform(x = 0.05, y = 0.28, w = 0.90, h = 0.15)
            "body" -> ShapeTransform(x = 0.05, y = 0.30, w = 0.90, h = 0.60)
            "dt", "ftr", "sldNum" -> ShapeTransform(x = 0.05, y = 0.92, w = 0.90, h = 0.05)
            else -> ShapeTransform(x = 0.05, y = 0.15, w = 0.90, h = 0.70)
        }
    }

    private fun parseColorScheme(clrSchemeEl: Element): Map<String, String> {
        val map = mutableMapOf<String, String>()
        for (child in clrSchemeEl.findChildren()) {
            val name = child.localNameOrName()
            val srgb = child.findFirstChild("srgbClr")
            if (srgb != null) {
                map[name] = "#" + srgb.getAttribute("val")
            } else {
                val sys = child.findFirstChild("sysClr")
                if (sys != null) {
                    val lastClr = sys.getAttribute("lastClr")
                    map[name] = if (lastClr.isNotEmpty()) "#$lastClr" else if (name.startsWith("dk") || name.contains("Text", true)) "#000000" else "#FFFFFF"
                }
            }
        }
        return map
    }

    private fun parseXmlEntry(zip: ZipFile, entryName: String): Document? {
        val entry = zip.getEntry(entryName) ?: zip.getEntry(entryName.removePrefix("/")) ?: return null

        // Zip-bomb guard: per-XML entry size cap (50MB)
        if (entry.size > 50L * 1024L * 1024L) {
            throw SecurityException("ZIP_BOMB_DETECTED: XML entry exceeds 50MB safety limit: ${entry.size} bytes")
        }

        return zip.getInputStream(entry).use { inputStream ->
            val factory = DocumentBuilderFactory.newInstance().apply {
                isNamespaceAware = false
                try {
                    // XXE Hardening: Disallow DOCTYPE declarations & external entities
                    setFeature("http://apache.org/xml/features/disallow-doctype-decl", true)
                    setFeature("http://xml.org/sax/features/external-general-entities", false)
                    setFeature("http://xml.org/sax/features/external-parameter-entities", false)
                    setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false)
                    isXIncludeAware = false
                    isExpandEntityReferences = false
                } catch (e: Exception) {
                    Log.w(TAG, "XML security features warning: ${e.message}")
                }
            }
            factory.newDocumentBuilder().parse(inputStream)
        }
    }

    private fun parseRelsEntry(zip: ZipFile, relsName: String): Map<String, String> {
        val rels = mutableMapOf<String, String>()
        val doc = parseXmlEntry(zip, relsName) ?: return rels
        for (child in doc.documentElement.findChildren("Relationship")) {
            val id = child.getAttribute("Id")
            val target = child.getAttribute("Target")
            if (id.isNotEmpty() && target.isNotEmpty()) {
                rels[id] = target
            }
        }
        return rels
    }

    private fun resolveTarget(basePath: String, target: String): String {
        if (target.startsWith("/")) return target.removePrefix("/")
        val baseSegments = basePath.split("/").dropLast(1).filter { it.isNotEmpty() }.toMutableList()
        val targetSegments = target.split("/").filter { it.isNotEmpty() }
        for (seg in targetSegments) {
            when (seg) {
                "." -> continue
                ".." -> if (baseSegments.isNotEmpty()) baseSegments.removeAt(baseSegments.lastIndex)
                else -> baseSegments.add(seg)
            }
        }
        return baseSegments.joinToString("/")
    }

    // DOM XML Traversal Extensions
    private fun Node.localNameOrName(): String {
        val n = nodeName ?: ""
        return if (n.contains(":")) n.substringAfter(":") else n
    }

    private fun Element.findFirstChild(localName: String): Element? {
        var child = firstChild
        while (child != null) {
            if (child.nodeType == Node.ELEMENT_NODE && child.localNameOrName().equals(localName, ignoreCase = true)) {
                return child as Element
            }
            child = child.nextSibling
        }
        return null
    }

    private fun Element.findFirstChildRecursive(localName: String): Element? {
        if (this.localNameOrName().equals(localName, ignoreCase = true)) return this
        var child = firstChild
        while (child != null) {
            if (child.nodeType == Node.ELEMENT_NODE) {
                val found = (child as Element).findFirstChildRecursive(localName)
                if (found != null) return found
            }
            child = child.nextSibling
        }
        return null
    }

    private fun Element.findChildren(localName: String? = null): List<Element> {
        val list = mutableListOf<Element>()
        var child = firstChild
        while (child != null) {
            if (child.nodeType == Node.ELEMENT_NODE) {
                if (localName == null || child.localNameOrName().equals(localName, ignoreCase = true)) {
                    list.add(child as Element)
                }
            }
            child = child.nextSibling
        }
        return list
    }
}

