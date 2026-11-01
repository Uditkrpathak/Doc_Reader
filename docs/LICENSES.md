# Open Source & Third-Party Software Licenses

This document enumerates the open-source software libraries, engines, and third-party components utilized in the **Universal File Viewer (ufv_rn_poc)** application.

---

## 1. Archive & Decompression Engines

### UnRAR (RARLab)
* **Components:** `unrarsrc-7.3.2`, JNI native bridge (`libunrar.so` for `arm64-v8a`, `armeabi-v7a`, `x86`, `x86_64`)
* **Author / Copyright:** Alexander L. Roshal (C) 1993-2024
* **License Type:** Custom Permissive Source License with Anti-Reverse-Engineering Clause
* **Terms Summary:** Free to use and distribute in binary format. May not be used to recreate the RAR compression algorithm.
```text
UnRAR - free utility for RAR archives
Copyright (c) 1993-2024 Alexander Roshal

The source code of UnRAR utility is freeware. This means:

1. All copyrights to RAR and the utility UnRAR are exclusively
   owned by the author - Alexander Roshal.

2. The UnRAR sources may be used in any software to handle
   RAR archives without limitations free of charge, but cannot be used
   to re-create the RAR compression algorithm, which is proprietary.
   Distribution of modified UnRAR sources in separate form or as a part
   of other software is permitted, provided that the full text of this
   license is included.

3. The UnRAR utility may be freely distributed. It is licensed
   "AS IS" without warranty of any kind.
```

### Zip4j
* **Components:** Java Archive Extraction Engine (`net.lingala.zip4j:zip4j:2.11.5`)
* **Author / Copyright:** Srikanth Reddy Lingala
* **License Type:** Apache License 2.0
```text
Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

---

## 2. Media Playback & Rendering

### Android Media3 ExoPlayer
* **Components:** `androidx.media3:media3-exoplayer:1.3.1`, `androidx.media3:media3-ui`, `androidx.media3:media3-common`
* **Author / Copyright:** The Android Open Source Project (Google LLC)
* **License Type:** Apache License 2.0
```text
Copyright (C) 2014 The Android Open Source Project

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

     http://www.apache.org/licenses/LICENSE-2.0
```

### Android Native PdfRenderer
* **Components:** `android.graphics.pdf.PdfRenderer`
* **Author / Copyright:** The Android Open Source Project
* **License Type:** Apache License 2.0

---

## 3. Document & Spreadsheet Viewers

### SheetJS (xlsx)
* **Components:** `xlsx.full.min.js`
* **Author / Copyright:** SheetJS LLC
* **License Type:** Apache License 2.0
```text
Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0
```

### PapaParse
* **Components:** `papaparse` (CSV Parser)
* **Author / Copyright:** Matt Holt (C) 2015
* **License Type:** MIT License
```text
The MIT License (MIT)

Copyright (c) 2015 Matthew Holt

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.
```

### docx-preview
* **Components:** `docx-preview.min.js`
* **Author / Copyright:** Roman Volkov (Volqa)
* **License Type:** MIT License
```text
MIT License

Copyright (c) 2019 Roman Volkov

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:
```

### mammoth.js
* **Components:** `mammoth.browser.min.js`
* **Author / Copyright:** Michael Williamson
* **License Type:** BSD 2-Clause License
```text
Copyright (c) 2013-2023, Michael Williamson
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.
```

### JSZip
* **Components:** `jszip.min.js`
* **Author / Copyright:** Stuart Knightley, David Duponchel, Franz Buchinger, António Afonso
* **License Type:** MIT License / Dual GPLv3
```text
Copyright (c) 2009-2016 Stuart Knightley, David Duponchel, Franz Buchinger, António Afonso

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software...
```

---

## 4. Storage & Application Framework

### React Native
* **Components:** `react-native`, `react`, `@facebook/hermes`
* **Author / Copyright:** Meta Platforms, Inc. and its affiliates
* **License Type:** MIT License
```text
MIT License

Copyright (c) Meta Platforms, Inc. and its affiliates.
```

### Tencent MMKV
* **Components:** `react-native-mmkv`
* **Author / Copyright:** Tencent Inc.
* **License Type:** BSD 3-Clause License
```text
Tencent is pleased to support the open source community by making MMKV available.
Copyright (C) 2018 THL A29 Limited, a Tencent company.  All rights reserved.
```

