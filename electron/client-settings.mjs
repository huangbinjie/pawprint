export function hooksSettingsScript(){return `tell application id "com.openai.codex" to activate
tell application "System Events"
  repeat 20 times
    set p to first application process whose frontmost is true
    if bundle identifier of p is "com.openai.codex" then exit repeat
    delay 0.1
  end repeat
  if bundle identifier of p is not "com.openai.codex" then return "settings-only"
  repeat 5 times
    try
      set itemsToCheck to entire contents of front window of p
      repeat with itemToCheck in itemsToCheck
        try
          set labelText to name of itemToCheck
          set itemRole to role of itemToCheck
          if (labelText is "Hooks" or labelText is "钩子") and (itemRole is "AXButton" or itemRole is "AXRadioButton" or itemRole is "AXLink") then
            perform action "AXPress" of itemToCheck
            return "opened-hooks"
          end if
        end try
      end repeat
    end try
    delay 0.2
  end repeat
end tell
return "settings-only"`;}
