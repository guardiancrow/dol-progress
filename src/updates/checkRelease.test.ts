import { afterEach, describe, expect, it, vi } from "vitest";
import { checkRelease, validateRelease, RELEASE_API_URL, MAX_BODY_BYTES, UPDATE_TIMEOUT_MS, UpdateCheckError } from "./checkRelease";
import { parseStableVersion, compareStableVersions } from "./version";
import { release, response } from "./testFixtures";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("stable versions", () => {
  it.each([
    ["0.3.0", "0.3.1", "newer"], ["0.3.1", "0.3.1", "same"], ["0.4.0", "0.3.1", "older"],
    ["0.3.9", "0.3.10", "newer"], ["1.99.99", "2.0.0", "newer"],
    ["9007199254740992.0.0", "9007199254740993.0.0", "newer"],
  ] as const)("compares %s and %s numerically", (current, remote, expected) => expect(compareStableVersions(current, remote)).toBe(expected));
  it.each(["01.2.3", "V0.3.1", "vv0.3.1", " 0.3.1", "0.3.1\n", "0.3", "+0.3.1", "０.3.1", "0.3.1-rc.1", "0.3.1+build", "<script>", "1".repeat(129)])("rejects unsupported %j", value => {
    expect(parseStableVersion(value, true)).toBeNull();
  });
  it("accepts only a single lowercase v on a release tag", () => {
    expect(parseStableVersion("v0.3.1", true)).toBe("0.3.1");
    expect(parseStableVersion("0.3.1", true)).toBe("0.3.1");
    expect(parseStableVersion("v0.3.1")).toBeNull();
  });
});

describe("untrusted release metadata", () => {
  it("requires the matching ZIP and external SHA-256 without using remote links or body", () => {
    const value = { ...release(), html_url: "javascript:alert(1)", body: "<script>throw 1</script>", zipball_url: "file:///synthetic" };
    expect(validateRelease(value, "0.3.0")).toEqual({ kind: "checked", version: "0.3.1", comparison: "newer", portableAvailable: true });
  });
  it.each(["draft", "prerelease"])("does not use %s releases", field => {
    expect(validateRelease({ ...release(), [field]: true }, "0.3.0")).toEqual({ kind: "uncomparable", reason: "release" });
  });
  it.each([null, [], {}, { ...release(), draft: "false" }, { ...release(), prerelease: undefined },
    { ...release(), published_at: null }, { ...release(), published_at: "yesterday" }, { ...release(), published_at: "2026-02-30T00:00:00Z" },
    { ...release(), tag_name: 123 }, { ...release(), assets: {} },
    { ...release(), assets: Array.from({length:257},()=>release().assets[0]) },
    { ...release(), assets: [null] }, { ...release(), assets: [{name:"x",state:"uploaded",size:"1"}] },
  ])("rejects malformed shape %#", value => expect(() => validateRelease(value, "0.3.0")).toThrow(UpdateCheckError));
  it.each(["v0.3.1-rc.1", "v0.3.1+build", "v00.3.1", "<img src=x onerror=alert(1)>"])("does not repair tag %s", tag => {
    expect(validateRelease(release(tag), "0.3.0")).toEqual({kind:"uncomparable",reason:"version"});
  });
  it.each(["missing-zip", "missing-hash", "duplicate", "wrong-version", "arm64", "pending", "zero", "oversize", "hash-oversize"])("does not recommend assets: %s", variant => {
    const value = release();
    if (variant === "missing-zip") value.assets.shift();
    if (variant === "missing-hash") value.assets.pop();
    if (variant === "duplicate") value.assets.push({...value.assets[0]});
    if (variant === "wrong-version") value.assets[0].name=value.assets[0].name.replace("0.3.1","0.3.2");
    if (variant === "arm64") value.assets[0].name=value.assets[0].name.replace("x64","arm64");
    if (variant === "pending") value.assets[0].state="starter";
    if (variant === "zero") value.assets[0].size=0;
    if (variant === "oversize") value.assets[0].size=96*1024*1024+1;
    if (variant === "hash-oversize") value.assets[1].size=1025;
    expect(validateRelease(value,"0.3.0")).toMatchObject({kind:"checked",comparison:"newer",portableAvailable:false});
  });
  it("uses only the returned Latest tag, not timestamps or a maximum inferred from other fields", () => {
    expect(validateRelease({...release("v0.3.1"),created_at:"2099-01-01T00:00:00Z",target_commitish:"v9.9.9"},"0.4.0")).toMatchObject({comparison:"older"});
  });
});

describe("fixed fetch transport", () => {
  it("sends one anonymous GET with no caller-controlled URL or version data", async () => {
    const request=vi.fn<typeof fetch>().mockResolvedValue(response(JSON.stringify(release())));
    expect(await checkRelease("0.3.0",new AbortController().signal,request)).toMatchObject({comparison:"newer",portableAvailable:true});
    expect(request).toHaveBeenCalledTimes(1);
    const [url, options] = request.mock.calls[0];
    expect(url).toBe(RELEASE_API_URL);
    expect(options).toEqual({method:"GET",mode:"cors",credentials:"omit",redirect:"error",cache:"no-store",referrerPolicy:"no-referrer",keepalive:false,signal:expect.any(AbortSignal),headers:{Accept:"application/vnd.github+json"}});
    expect(options?.signal?.aborted).toBe(false);
  });
  it("does not fetch for an unsupported current version", async () => {
    const request=vi.fn<typeof fetch>();
    expect(await checkRelease("0.3.1-beta",new AbortController().signal,request)).toEqual({kind:"uncomparable",reason:"version"});
    expect(request).not.toHaveBeenCalled();
  });
  it.each([403,404,429,500,204,304,302])("fails for HTTP %i",async status=>{
    const result = status===204||status===304 ? new Response(null,{status}) : response("{}",status);
    Object.defineProperty(result,"url",{value:RELEASE_API_URL,configurable:true});
    const request=vi.fn<typeof fetch>().mockResolvedValue(result);
    await expect(checkRelease("0.3.0",new AbortController().signal,request)).rejects.toMatchObject({code:"http",status});
  });
  it("honors rate headers without making a second request", async () => {
    const request=vi.fn<typeof fetch>().mockResolvedValue(response("{}",429,{"retry-after":"120","x-ratelimit-remaining":"0","x-ratelimit-reset":"500"}));
    await expect(checkRelease("0.3.0",new AbortController().signal,request,()=>1000)).rejects.toMatchObject({code:"http",retryAt:500000});
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("honors HTTP-date Retry-After and safely defaults invalid headers",async()=>{
    for(const [headers,expected] of [
      [{"retry-after":"Thu, 01 Jan 2026 00:00:00 GMT"},Date.parse("2026-01-01T00:00:00Z")],
      [{"retry-after":"invalid","x-ratelimit-remaining":"0","x-ratelimit-reset":"NaN"},61000],
    ] as const) {
      await expect(checkRelease("0.3.0",new AbortController().signal,vi.fn<typeof fetch>().mockResolvedValue(response("{}",403,headers)),()=>1000)).rejects.toMatchObject({code:"http",retryAt:expected});
    }
  });
  it("accepts a valid body exactly at the byte limit without a length header",async()=>{
    const original=JSON.stringify(release());
    const body=original+" ".repeat(MAX_BODY_BYTES-new TextEncoder().encode(original).byteLength);
    await expect(checkRelease("0.3.0",new AbortController().signal,vi.fn<typeof fetch>().mockResolvedValue(response(body)))).resolves.toMatchObject({comparison:"newer"});
  });
  it.each(["DNS", "TLS", "CORS", "redirect"])("handles indistinguishable %s rejection", async message => {
    await expect(checkRelease("0.3.0",new AbortController().signal,vi.fn<typeof fetch>().mockRejectedValue(new TypeError(message)))).rejects.toMatchObject({code:"network"});
  });
  it.each(["https://example.invalid/",`${RELEASE_API_URL}?x=1`])("rejects unexpected response URL %s",async url=>{
    await expect(checkRelease("0.3.0",new AbortController().signal,vi.fn<typeof fetch>().mockResolvedValue(response("{}",200,{},url)))).rejects.toMatchObject({code:"response"});
  });
  it("rejects a redirected response even when its final URL matches",async()=>{
    const value=response("{}"); Object.defineProperty(value,"redirected",{value:true});
    await expect(checkRelease("0.3.0",new AbortController().signal,vi.fn<typeof fetch>().mockResolvedValue(value))).rejects.toMatchObject({code:"response"});
  });
  it.each(["{", "", "null", '{"assets":[]}'])("rejects invalid JSON/shape %j",async body=>{
    await expect(checkRelease("0.3.0",new AbortController().signal,vi.fn<typeof fetch>().mockResolvedValue(response(body)))).rejects.toMatchObject({code:"response"});
  });
  it("rejects non-JSON MIME and malformed UTF-8",async()=>{
    for(const result of [response("{}",200,{"Content-Type":"text/html"}), new Response(new Uint8Array([255]),{headers:{"Content-Type":"application/json"}})]) {
      Object.defineProperty(result,"url",{value:RELEASE_API_URL,configurable:true});
      await expect(checkRelease("0.3.0",new AbortController().signal,vi.fn<typeof fetch>().mockResolvedValue(result))).rejects.toMatchObject({code:"response"});
    }
  });
  it("rejects excessive Content-Length before reading",async()=>{
    await expect(checkRelease("0.3.0",new AbortController().signal,vi.fn<typeof fetch>().mockResolvedValue(response("{}",200,{"Content-Length":String(MAX_BODY_BYTES+1)})))).rejects.toMatchObject({code:"too-large"});
  });
  it("counts streamed bytes despite a false small length and cancels on overflow",async()=>{
    const cancel=vi.fn();
    const stream=new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array(MAX_BODY_BYTES));c.enqueue(new Uint8Array([1]));},cancel});
    const result=new Response(stream,{headers:{"Content-Type":"application/json","Content-Length":"1"}});
    Object.defineProperty(result,"url",{value:RELEASE_API_URL});
    await expect(checkRelease("0.3.0",new AbortController().signal,vi.fn<typeof fetch>().mockResolvedValue(result))).rejects.toMatchObject({code:"too-large"});
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it.each(["headers","body"])("times out stalled %s and aborts/cancels",async phase=>{
    vi.useFakeTimers();
    const cancel=vi.fn();
    const stalled=new Response(new ReadableStream({cancel}),{headers:{"Content-Type":"application/json"}});
    Object.defineProperty(stalled,"url",{value:RELEASE_API_URL});
    const request=vi.fn<typeof fetch>().mockImplementation(()=>phase==="headers"?new Promise(()=>undefined):Promise.resolve(stalled));
    const promise=checkRelease("0.3.0",new AbortController().signal,request);
    const expectation=expect(promise).rejects.toMatchObject({code:"timeout"});
    await vi.advanceTimersByTimeAsync(UPDATE_TIMEOUT_MS);
    await expectation;
    expect(request.mock.calls[0][1]?.signal?.aborted).toBe(true);
    if(phase==="body") expect(cancel).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("cancels an active request and skips a request already aborted",async()=>{
    const active=new AbortController();
    const request=vi.fn<typeof fetch>().mockImplementation(()=>new Promise(()=>undefined));
    const promise=checkRelease("0.3.0",active.signal,request);
    const expectation=expect(promise).rejects.toMatchObject({name:"AbortError"});
    active.abort(); await expectation;
    request.mockClear();
    await expect(checkRelease("0.3.0",active.signal,request)).rejects.toMatchObject({name:"AbortError"});
    expect(request).not.toHaveBeenCalled();
  });
});
