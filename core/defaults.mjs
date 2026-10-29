export const DEFAULT_SETTINGS=Object.freeze({
  language:'en',connected:true,floating:true,desktopShellVersion:1,
  idleEnabled:true,idleToys:true,idleMouse:true,companionProactive:true,
  activityEnabled:true,activityTopics:true,attentionEnabled:true,capacityRetryEnabled:true,
  quotaEnabled:true,quotaWindow:'weekly',quotaGuardEnabled:true,quotaGuardThreshold:10,quotaGuardWindow:'auto',workReminder:'quiet',workDnd:false,
});
export function defaultSettings(existing={}){
  return {...DEFAULT_SETTINGS,...existing};
}
