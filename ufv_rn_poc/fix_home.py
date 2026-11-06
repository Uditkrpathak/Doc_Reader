import re, sys, os

os.chdir(r'C:\Users\uditp\Desktop\Doc_Reader\ufv_rn_poc')

filepath = r'src\screens\HomeScreen.tsx'

with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

fixes_done = []

# Fix 1: Remove setPreviewMode from brand container
if 'setPreviewMode' in content:
    content = re.sub(
        r'<TouchableOpacity\s+style=\{styles\.brandContainer\}\s+activeOpacity=\{0\.7\}\s+onPress=\{[^}]+setPreviewMode[^}]+\}>\s+',
        '<View style={styles.brandContainer}>\n            ',
        content,
        flags=re.DOTALL
    )
    content = re.sub(
        r'(\s+<Text style=\{styles\.brandTitle\}>My Files</Text>)\s+</TouchableOpacity>',
        r'\1\n          </View>',
        content
    )
    fixes_done.append('Fix 1: removed setPreviewMode')
else:
    fixes_done.append('Fix 1 SKIPPED: no setPreviewMode found')

# Fix 2: Storage bar - replace hardcoded flex with real data
old_bar = '              <View style={[styles.storageSegmentMedia, { flex: 0.22 }]} />\r\n              <View style={[styles.storageSegmentDocs, { flex: 0.12 }]} />\r\n              <View style={[styles.storageSegmentSystem, { flex: 0.06 }]} />\r\n              <View style={[styles.storageSegmentFree, { flex: 0.60 }]} />'
old_bar2 = '              <View style={[styles.storageSegmentMedia, { flex: 0.22 }]} />\n              <View style={[styles.storageSegmentDocs, { flex: 0.12 }]} />\n              <View style={[styles.storageSegmentSystem, { flex: 0.06 }]} />\n              <View style={[styles.storageSegmentFree, { flex: 0.60 }]} />'

new_bar = """              {storageUsage ? (
                <>
                  <View style={[styles.storageSegmentMedia, { flex: Math.max(0.01, storageUsage.mediaBytes / storageUsage.totalBytes) }]} />
                  <View style={[styles.storageSegmentDocs, { flex: Math.max(0.01, storageUsage.docsBytes / storageUsage.totalBytes) }]} />
                  <View style={[styles.storageSegmentSystem, { flex: Math.max(0.01, (storageUsage.usedBytes - storageUsage.mediaBytes - storageUsage.docsBytes) / storageUsage.totalBytes) }]} />
                  <View style={[styles.storageSegmentFree, { flex: Math.max(0.01, (storageUsage.totalBytes - storageUsage.usedBytes) / storageUsage.totalBytes) }]} />
                </>
              ) : (
                <>
                  <View style={[styles.storageSegmentMedia, { flex: 0.22 }]} />
                  <View style={[styles.storageSegmentDocs, { flex: 0.12 }]} />
                  <View style={[styles.storageSegmentSystem, { flex: 0.06 }]} />
                  <View style={[styles.storageSegmentFree, { flex: 0.60 }]} />
                </>
              )}"""

if old_bar in content:
    content = content.replace(old_bar, new_bar)
    fixes_done.append('Fix 2: storage bar CRLF matched')
elif old_bar2 in content:
    content = content.replace(old_bar2, new_bar)
    fixes_done.append('Fix 2: storage bar LF matched')
else:
    fixes_done.append('Fix 2 SKIPPED: bar pattern not found - checking...')
    idx = content.find('storageSegmentMedia')
    fixes_done.append(f'  Found storageSegmentMedia at index: {idx}')
    if idx > 0:
        fixes_done.append(f'  Context: {repr(content[idx-50:idx+150])}')

# Fix 3: Storage legend to use real data
old_legend_lf = "                <Text style={styles.legendText}>Media (25.6 GB)</Text>"
old_legend_docs = "                <Text style={styles.legendText}>Docs (11.5 GB)</Text>"
old_legend_sys = "                <Text style={styles.legendText}>System (5.7 GB)</Text>"

if old_legend_lf in content:
    content = content.replace(
        old_legend_lf,
        "                <Text style={styles.legendText}>{storageUsage ? `Media (${(storageUsage.mediaBytes/(1024*1024*1024)).toFixed(1)} GB)` : 'Media (25.6 GB)'}</Text>"
    )
    fixes_done.append('Fix 3a: media legend')

if old_legend_docs in content:
    content = content.replace(
        old_legend_docs,
        "                <Text style={styles.legendText}>{storageUsage ? `Docs (${(storageUsage.docsBytes/(1024*1024*1024)).toFixed(1)} GB)` : 'Docs (11.5 GB)'}</Text>"
    )
    fixes_done.append('Fix 3b: docs legend')

if old_legend_sys in content:
    content = content.replace(
        old_legend_sys,
        "                <Text style={styles.legendText}>{storageUsage ? `System (${Math.max(0, (storageUsage.usedBytes-storageUsage.mediaBytes-storageUsage.docsBytes)/(1024*1024*1024)).toFixed(1)} GB)` : 'System (5.7 GB)'}</Text>"
    )
    fixes_done.append('Fix 3c: system legend')

# Fix 4: Continue reading meta - real pos data
old_cont = "                  Page 12 of 48 \u00b7 Today"
new_cont = "                  {effectiveContinueFile.pos?.page && effectiveContinueFile.pos?.total ? `Page ${effectiveContinueFile.pos.page} of ${effectiveContinueFile.pos.total} \u00b7 ${formatRelativeTime(effectiveContinueFile.pos.timestamp)}` : formatRelativeTime(effectiveContinueFile.timestamp)}"

if old_cont in content:
    content = content.replace(old_cont, new_cont)
    fixes_done.append('Fix 4: continue reading real pos')
else:
    fixes_done.append('Fix 4 SKIPPED: continue meta not found')

# Fix 5: Progress bar fill width
old_prog = "                  width: '28%',"
new_prog = "                  width: `${effectiveContinueFile?.pos?.page && effectiveContinueFile?.pos?.total ? Math.round((effectiveContinueFile.pos.page / effectiveContinueFile.pos.total) * 100) : 25}%`,"

if old_prog in content:
    content = content.replace(old_prog, new_prog)
    fixes_done.append('Fix 5: progress bar real width')
else:
    fixes_done.append('Fix 5 SKIPPED: progress width not found')

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

for fix in fixes_done:
    print(fix)

print('\nAll done.')
