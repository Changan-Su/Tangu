/**
 * 文本兜底工具调用解析(provider 工具模板与模型输出不匹配时的兜底)。
 *
 * 现象:经网关/聚合代理的开源模型常把工具调用当**正文**吐出(推理端没配对该模型的
 * tool-call 解析模板),导致原生 tool_calls 为空、下游 agent 误判"无工具调用"收尾停住。
 * 不同模型吐**不同的原生格式**,本文件多格式兜底,仅当原生 tool_calls 为空时启用:
 *   ① Anthropic 式:<invoke name="X"><parameter name="Y" string="true|false">Z</parameter></invoke>
 *      (前缀可能是 antml:、被网关替换成 ｜｜DSML｜｜ 等占位,或无前缀;DeepSeek-V4-Pro 走这个)
 *   ② Kimi K2 式:<|tool_call_begin|>functions.NAME:IDX<|tool_call_argument_begin|>{json}<|tool_call_end|>
 *   ③ DeepSeek 原生:<｜tool▁call▁begin｜>function<｜tool▁sep｜>NAME ```json {json} ```<｜tool▁call▁end｜>
 *
 * 安全:解析出的调用与原生调用走同一套审批闸门;仅在原生 tool_calls 为空时启用,正常流零影响。
 */
export interface ParsedTextToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

type ParseResult = { toolCalls: ParsedTextToolCall[]; cleaned: string };

function call(idx: number, name: string, argsJson: string): ParsedTextToolCall {
  return { id: `call_fb_${idx}`, type: 'function', function: { name, arguments: argsJson } };
}

/** ① Anthropic <invoke>/<parameter>(前缀容错);string="false" 的参数按 JSON 解析。 */
function parseAnthropic(content: string): ParseResult | null {
  if (!/invoke\s+name=/i.test(content)) return null;
  const invokeRe = /<[^>]*?invoke\s+name="([^"]+)"\s*>([\s\S]*?)<\/[^>]*?invoke\s*>/gi;
  const calls: ParsedTextToolCall[] = [];
  let m: RegExpExecArray | null;
  while ((m = invokeRe.exec(content)) !== null) {
    const name = m[1].trim();
    if (!name) continue;
    const body = m[2];
    const args: Record<string, unknown> = {};
    const paramRe =
      /<[^>]*?parameter\s+name="([^"]+)"(?:\s+string="([^"]*)")?\s*>([\s\S]*?)<\/[^>]*?parameter\s*>/gi;
    let pm: RegExpExecArray | null;
    while ((pm = paramRe.exec(body)) !== null) {
      const key = pm[1];
      const hint = pm[2]; // 'true' | 'false' | undefined
      const raw = pm[3].trim();
      if (hint === 'false') {
        try {
          args[key] = JSON.parse(raw);
        } catch {
          args[key] = raw;
        }
      } else {
        args[key] = raw;
      }
    }
    calls.push(call(calls.length, name, JSON.stringify(args)));
  }
  if (!calls.length) return null;
  const cleaned = content.replace(invokeRe, '').replace(/<\/?[^>]*?tool_calls\s*>/gi, '').trim();
  return { toolCalls: calls, cleaned };
}

/** ② Kimi K2 <|tool_call_begin|>functions.NAME:IDX<|tool_call_argument_begin|>{json}<|tool_call_end|> */
function parseKimi(content: string): ParseResult | null {
  if (!content.includes('<|tool_call_begin|>')) return null;
  const re = /<\|tool_call_begin\|>([\s\S]*?)<\|tool_call_argument_begin\|>([\s\S]*?)<\|tool_call_end\|>/g;
  const calls: ParsedTextToolCall[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const name = m[1].trim().replace(/^functions\./, '').replace(/:\d+\s*$/, '').trim();
    if (!name) continue;
    const args = m[2].trim();
    calls.push(call(calls.length, name, args.startsWith('{') ? args : '{}'));
  }
  if (!calls.length) return null;
  const cleaned = content.replace(re, '').replace(/<\|tool_calls_section_(?:begin|end)\|>/g, '').trim();
  return { toolCalls: calls, cleaned };
}

/** ③ DeepSeek 原生 <｜tool▁call▁begin｜>function<｜tool▁sep｜>NAME ```json {json} ```<｜tool▁call▁end｜>。
 *     ｜=U+FF5C ▁=U+2581,用转义避免源码编码歧义。 */
function parseDeepSeek(content: string): ParseResult | null {
  if (!content.includes('｜tool▁call▁begin｜')) return null;
  const re = /<｜tool▁call▁begin｜>[\s\S]*?<｜tool▁sep｜>([\s\S]*?)<｜tool▁call▁end｜>/g;
  const calls: ParsedTextToolCall[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const seg = m[1].trim();
    const nm = seg.match(/^([A-Za-z0-9_.\-]+)/);
    if (!nm) continue;
    const name = nm[1].replace(/^functions\./, '');
    const jm = seg.match(/```(?:json)?\s*([\s\S]*?)```/);
    let args = jm ? jm[1].trim() : seg.slice(nm[0].length).trim();
    if (!args.startsWith('{')) args = '{}';
    calls.push(call(calls.length, name, args));
  }
  if (!calls.length) return null;
  const cleaned = content
    .replace(re, '')
    .replace(/<｜tool▁calls▁(?:begin|end)｜>/g, '')
    .trim();
  return { toolCalls: calls, cleaned };
}

export function parseTextToolCalls(content: string): ParseResult {
  if (!content || content.length > 200_000) return { toolCalls: [], cleaned: content };
  return (
    parseAnthropic(content) ||
    parseKimi(content) ||
    parseDeepSeek(content) || { toolCalls: [], cleaned: content }
  );
}
