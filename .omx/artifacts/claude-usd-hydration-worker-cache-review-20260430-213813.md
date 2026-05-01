## Original User Task

用户要求继续压低 USDA/USD 链路的主线程阻塞，并明确要求调用 Claude 帮忙 review。

## Final Prompt Sent To Claude CLI

Review this URDF-Studio change for correctness and regressions. Context: selected USD hydration currently uses an offscreen USD worker. I changed it so the offscreen worker prepares the USD prepared export cache from the full scene snapshot and transfers it with the robot-data message, letting the main hydration resolve without waiting for a full scene-snapshot message. I also changed stage-open worker payload preparation to avoid recursive USDA reference scanning on the main thread; it now sends compacted USD layer candidates and USD-layer assets for exact filtering in the worker. I changed prepared USD viewer asset object URLs from a synchronous useLayoutEffect to batched useEffect with cleanup. Please focus on correctness risks, race/resource leaks, and whether behavior remains equivalent. Here is the git diff:

<git diff was inlined in the CLI prompt>

## Claude Output Raw

First attempt:

```text
$ claude -p "<prompt>"
API Error: 405 <html>
<head><title>405 Not Allowed</title></head>
<body>
<center><h1>405 Not Allowed</h1></center>
<hr><center>openresty</center>
</body>
</html>
```

Second attempt through the OMX wrapper requested by the skill:

```text
$ omx ask claude "<prompt>"
zsh:1: command not found: omx
```

## Concise Summary

Claude CLI review could not complete in this environment. The local `claude` binary is present enough to run, but its API request failed with HTTP 405. The OMX wrapper is not installed on PATH.

## Action Items / Next Steps

- Continue with local tests, typecheck, lint/build, and targeted browser regression for the USD hydration path.
- Treat this artifact as evidence that the requested Claude review was attempted but blocked by local CLI/backend configuration.
