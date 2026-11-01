cmake_minimum_required(VERSION 3.18.1)

project("unrar_jni")

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_definitions(
    -D_FILE_OFFSET_BITS=64
    -D_LARGEFILE_SOURCE
    -DRAR_SMP
    -DRARDLL
    -D_UNIX
    -DSILENT
)

set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -O3 -Wno-macro-redefined -Wno-logical-op-parentheses -Wno-switch -Wno-dangling-else -Wno-unused-parameter -Wno-unused-variable -Wno-unused-function")

include_directories(unrar)

set(UNRAR_SOURCES
    unrar/strlist.cpp
    unrar/strfn.cpp
    unrar/pathfn.cpp
    unrar/smallfn.cpp
    unrar/global.cpp
    unrar/file.cpp
    unrar/filefn.cpp
    unrar/filcreat.cpp
    unrar/archive.cpp
    unrar/arcread.cpp
    unrar/unicode.cpp
    unrar/system.cpp
    unrar/crypt.cpp
    unrar/crc.cpp
    unrar/rawread.cpp
    unrar/encname.cpp
    unrar/resource.cpp
    unrar/match.cpp
    unrar/timefn.cpp
    unrar/rdwrfn.cpp
    unrar/consio.cpp
    unrar/options.cpp
    unrar/errhnd.cpp
    unrar/rarvm.cpp
    unrar/secpassword.cpp
    unrar/rijndael.cpp
    unrar/getbits.cpp
    unrar/sha1.cpp
    unrar/sha256.cpp
    unrar/blake2s.cpp
    unrar/hash.cpp
    unrar/extinfo.cpp
    unrar/extract.cpp
    unrar/volume.cpp
    unrar/list.cpp
    unrar/find.cpp
    unrar/unpack.cpp
    unrar/headers.cpp
    unrar/threadpool.cpp
    unrar/rs16.cpp
    unrar/cmddata.cpp
    unrar/ui.cpp
    unrar/largepage.cpp
    unrar/filestr.cpp
    unrar/scantree.cpp
    unrar/dll.cpp
    unrar/qopen.cpp
)

add_library(
    unrar_jni
    SHARED
    unrar_jni.cpp
    ${UNRAR_SOURCES}
)

find_library(log-lib log)

target_link_libraries(
    unrar_jni
    ${log-lib}
)

