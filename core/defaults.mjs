export const DEFAULT_SETTINGS=Object.freeze({
  language:'en',connected:true,floating:true,desktopShellVersion:1,
  idleEnabled:true,idleToys:true,idleMouse:true,companionProactive:true,
  activityEnabled:true,activityTopics:true,attentionEnabled:true,
  quotaEnabled:true,quotaWindow:'weekly',workReminder:'quiet',workDnd:false,
});
export function defaultSettings(existing={}){
  return {...DEFAULT_SETTINGS,...existing};
}
