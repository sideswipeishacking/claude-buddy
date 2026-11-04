# Claude Buddy UI Automation helper.
# Reads "items <hwnd>" lines on stdin and answers each with one JSON line: the
# selected files of that open-file dialog (their screen rectangles) and the
# file list's rectangle, in physical pixels. Only the dialog's own window tree
# is queried (it's a Windows shell view, not the Chromium app that owns it).
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$AE = [System.Windows.Automation.AutomationElement]
$Scope = [System.Windows.Automation.TreeScope]
$SelPattern = [System.Windows.Automation.SelectionPattern]::Pattern
[Console]::Out.WriteLine('{"ready":true}')
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  try {
    $hwnd = [IntPtr][Int64]($line.Split(' ')[1])
    $root = $AE::FromHandle($hwnd)
    $cond = New-Object System.Windows.Automation.PropertyCondition($AE::ClassNameProperty, 'UIItemsView')
    $list = $root.FindFirst($Scope::Descendants, $cond)
    if ($null -eq $list) { [Console]::Out.WriteLine('{"ok":false,"error":"no file list"}'); continue }
    $items = @()
    $pattern = $null
    if ($list.TryGetCurrentPattern($SelPattern, [ref]$pattern)) {
      foreach ($e in $pattern.Current.GetSelection()) {
        $r = $e.Current.BoundingRectangle
        if (-not $r.IsEmpty -and $r.Width -gt 0) { $items += [pscustomobject]@{ name = $e.Current.Name; type = $e.Current.ItemType; x = $r.X; y = $r.Y; w = $r.Width; h = $r.Height } }
      }
    }
    $lr = $list.Current.BoundingRectangle
    $out = [pscustomobject]@{ ok = $true; items = $items; list = [pscustomobject]@{ x = $lr.X; y = $lr.Y; w = $lr.Width; h = $lr.Height } }
    [Console]::Out.WriteLine(($out | ConvertTo-Json -Compress -Depth 4))
  } catch {
    [Console]::Out.WriteLine((@{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress))
  }
}
