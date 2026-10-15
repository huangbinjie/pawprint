// A provider ID is an accounting identity; its user-visible name is separate.
export function providerLabel(id, names = {}, customLabel = '自定义 Provider') {
  if (id === 'openai') return 'ChatGPT / OpenAI';
  const name=Object.hasOwn(names,id)?names[id]:null;
  if(typeof name==='string'&&name.trim())return name.trim();
  if(/^pawprint_[a-f0-9]{32}$/.test(id||''))return `${customLabel} · ${id.slice(-6)}`;
  return typeof id==='string'&&id.trim()?id:customLabel;
}
