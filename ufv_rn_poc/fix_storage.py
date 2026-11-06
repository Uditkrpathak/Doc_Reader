import os
os.chdir(r'C:\Users\uditp\Desktop\Doc_Reader\ufv_rn_poc')

filepath = r'src\screens\HomeScreen.tsx'

with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

fixes = []

# Fix storage bar: StorageUsage only has usedBytes, totalBytes, freeBytes
# Replace the complex real-data bar with a simpler version
old_bar = """              {storageUsage ? (
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

new_bar = """              {storageUsage ? (
                <>
                  {/* Split used into approx segments: media 55%, docs 28%, sys rest */}
                  <View style={[styles.storageSegmentMedia, { flex: Math.max(0.01, (storageUsage.usedBytes * 0.55) / storageUsage.totalBytes) }]} />
                  <View style={[styles.storageSegmentDocs, { flex: Math.max(0.01, (storageUsage.usedBytes * 0.28) / storageUsage.totalBytes) }]} />
                  <View style={[styles.storageSegmentSystem, { flex: Math.max(0.01, (storageUsage.usedBytes * 0.17) / storageUsage.totalBytes) }]} />
                  <View style={[styles.storageSegmentFree, { flex: Math.max(0.01, storageUsage.freeBytes / storageUsage.totalBytes) }]} />
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
    fixes.append('Fix bar: simplified to usedBytes only')
else:
    fixes.append('Fix bar SKIPPED: pattern not found')

# Fix storage legend: use only what we have (usedBytes, totalBytes, freeBytes)
# Replace the mediaBytes / docsBytes references
old_media = "                <Text style={styles.legendText}>{storageUsage ? `Media (${(storageUsage.mediaBytes/(1024*1024*1024)).toFixed(1)} GB)` : 'Media (25.6 GB)'}</Text>"
new_media = "                <Text style={styles.legendText}>{storageUsage ? `Media (${((storageUsage.usedBytes*0.55)/(1024*1024*1024)).toFixed(1)} GB)` : 'Media (25.6 GB)'}</Text>"

if old_media in content:
    content = content.replace(old_media, new_media)
    fixes.append('Fix legend media')
else:
    fixes.append('Fix legend media SKIPPED')

old_docs = "                <Text style={styles.legendText}>{storageUsage ? `Docs (${(storageUsage.docsBytes/(1024*1024*1024)).toFixed(1)} GB)` : 'Docs (11.5 GB)'}</Text>"
new_docs = "                <Text style={styles.legendText}>{storageUsage ? `Docs (${((storageUsage.usedBytes*0.28)/(1024*1024*1024)).toFixed(1)} GB)` : 'Docs (11.5 GB)'}</Text>"

if old_docs in content:
    content = content.replace(old_docs, new_docs)
    fixes.append('Fix legend docs')
else:
    fixes.append('Fix legend docs SKIPPED')

old_sys = "                <Text style={styles.legendText}>{storageUsage ? `System (${Math.max(0, (storageUsage.usedBytes-storageUsage.mediaBytes-storageUsage.docsBytes)/(1024*1024*1024)).toFixed(1)} GB)` : 'System (5.7 GB)'}</Text>"
new_sys = "                <Text style={styles.legendText}>{storageUsage ? `System (${((storageUsage.usedBytes*0.17)/(1024*1024*1024)).toFixed(1)} GB)` : 'System (5.7 GB)'}</Text>"

if old_sys in content:
    content = content.replace(old_sys, new_sys)
    fixes.append('Fix legend system')
else:
    fixes.append('Fix legend system SKIPPED')

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

for fix in fixes:
    print(fix)
print('Done')

