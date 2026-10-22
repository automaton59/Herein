# Electron profile 隔离补丁

原 `main.cjs` 在多个异步文件读取后才设置 userData。一部分 GPU/网络子进程会先采用默认 `AppData/Roaming/Herein Interaction`，不能把指定 `--data-dir` 单独视为完整 Chromium profile 隔离。

已修复 `launch.cjs` 和便携包启动脚本：进程创建时传同一 `--user-data-dir`。实测二者的 Electron 全进程树都指向各自临时目录。

直接 Electron/登录入口还需本补丁：首次 await 前同步设置 userData/sessionData 与 commandLine。它尚未应用到冻结主源码，以保留两条原GGUF长测及build身份。原长测有此隔离缺口，不能证明补丁通过；没有删除或修改默认profile文件。

在原长测结束、审阅和保留后应用：

```powershell
git apply --check --ignore-space-change apps/interaction/pending/profile-isolation/main.patch
git apply --ignore-space-change apps/interaction/pending/profile-isolation/main.patch
```

与SAPI补丁应用后记新build。必须对直接Electron入口（不额外传user-data-dir）、环境变量入口、带空格路径的独立实例查CIM全树创建身份和缓存路径。真实登录仍待真人验收；不能用这个软件检查代替开机自启证明。

隔离候选 `tmp/interaction-profile-candidate` buildId `df6cb5cd9671efe3d1d6575863c64acffc59fbd41d8c02467d2177f21124bf3d`，只应用此main补丁、保持冻结renderer和原SAPI源码。直接Electron不传user-data-dir的实例PID29020，数据 `tmp/interaction-profile-direct-data`；6个Electron进程含指定数据路径，无默认profile。环境变量入口PID28872，数据 `tmp/interaction profile env data`；5个Electron子进程均含带空格的数据路径，主进程原命令行只含入口且不会因appendSwitch改写，不能以主进程命令行无路径判失败。两个实例均avatarReady/ASR/TTS=true、micActive=false，随后按创建身份和候选目录核对回收，未修改真实登录设置。原冻结buildId不能代替候选证明。
