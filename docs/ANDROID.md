# Android（Capacitor）

## 现在有什么

- `android/`：Capacitor 8.5.3 生成的 Android 工程。
- `src/mobile/MobileApp.tsx`：移动聊天页，连局域网 Core。
- `capacitor.config.ts`：`webDir=dist`，允许 mixed content（LAN 是明文 HTTP）。
- `AndroidManifest.xml`：`usesCleartextTraffic="true"`。

## 本机环境（已装）

- JDK 21：`D:\Android\jdk21`
- Android SDK：`D:\Android\sdk`（platform 36 / build-tools 36.0.0 / platform-tools）
- Gradle 缓存：`D:\Android\gradle-home`
- Gradle 分发包走腾讯镜像：`mirrors.cloud.tencent.com/gradle`
- `android/local.properties`：`sdk.dir=D:/Android/sdk`（已 gitignore）

## 构建

一条命令：

```powershell
npm run android:build
```

它会自动：

1. `npm run build`（含 core boundary + tsc + vite）
2. `npx cap sync android`
3. `gradlew assembleDebug`
4. 复制到 `exports/herein-debug.apk` 并打印 SHA256

APK：

```text
D:\Herein\exports\herein-debug.apk
```

当前校验：

```text
package: app.herein.mobile
size:    4484515 bytes
sha256:  0D2910664F1BA26A5F54C7ECD058C57993E7AE1DB92EF0858088B0FF09043E18
```

手动构建：

```powershell
npm run build
npx cap sync android
cd android
.\gradlew.bat assembleDebug
```

## 手机怎么连

1. PC 启动 Core：

```powershell
$env:HEREIN_CORE_HOST = "0.0.0.0"
$env:HEREIN_CORE_PORT = "8787"
$env:HEREIN_CORE_TOKEN = "换一个长随机串"
npm run core:serve
```

2. 手机和 PC 连同一个 Wi-Fi。
3. 打开 APP，填：

```text
http://192.168.1.3:8787
```

4. Token 填 `HEREIN_CORE_TOKEN`；如果 Core 只绑 `127.0.0.1`，手机连不上，必须绑 `0.0.0.0`。
5. Windows 防火墙要放行 8787（如果当前网络是 Public）。

## 安全

- LAN 明文 HTTP，只有 E2EE/局域网可信环境可接受；公网不要直接暴露 8787。
- 远程走 P1c 的 Caddy 80 `/herein` 或 Tailscale。
- `private/`、`android/local.properties`、Gradle 构建产物不进 git。
