#Requires -Version 5.1
<#
.SYNOPSIS
    FIREWALL-SETUP.ps1 — Idempotent Windows Firewall rules for the Fullsite Bridge.

.DESCRIPTION
    Closes gap #3 (FAIL) of INSTALLER-VERIFICATION.md. The Local Server listens
    on 0.0.0.0:7717 (local-server/index.js) and announces _fullsite-pos._tcp via
    mDNS (UDP 5353, local-server/discovery/mdns.js). Without inbound rules,
    Windows Defender silently blocks LAN terminals/KDS from reaching SERVER1.

    Creates (scoped to LocalSubnet only — never open to internet):
      "Fullsite POS Bridge"  Inbound Allow TCP 7717
      "Fullsite mDNS"        Inbound Allow UDP 5353

    Port 7718 (fingerprint) stays loopback-only (proxied via /fp/* on 7717) —
    no rule needed, none created.

    Idempotent: safe to re-run; existing rules are replaced with the exact
    desired configuration. Requires Administrator.

.PARAMETER Remove
    Delete both rules instead of creating them (undo).

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\FIREWALL-SETUP.ps1
.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\FIREWALL-SETUP.ps1 -Remove
#>
param(
    [switch]$Remove
)

Set-StrictMode -Off
$ErrorActionPreference = 'Stop'

# ── Admin check ───────────────────────────────────────────────────────────────
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host '[ERROR] Administrator privileges required. Run from an elevated prompt'
    Write-Host '        (or via INSTALL.cmd, which elevates automatically).'
    exit 1
}

$rules = @(
    @{ DisplayName = 'Fullsite POS Bridge'; Protocol = 'TCP'; LocalPort = 7717
       Description = 'Fullsite Local Server HTTP + WebSocket (LAN terminals/KDS) — puerto 7717' },
    @{ DisplayName = 'Fullsite mDNS';       Protocol = 'UDP'; LocalPort = 5353
       Description = 'Fullsite mDNS discovery _fullsite-pos._tcp — puerto UDP 5353' }
)

$failed = 0
foreach ($r in $rules) {
    $existing = Get-NetFirewallRule -DisplayName $r.DisplayName -ErrorAction SilentlyContinue
    if ($Remove) {
        if ($existing) {
            $existing | Remove-NetFirewallRule
            Write-Host "[OK] Removed rule: $($r.DisplayName)"
        } else {
            Write-Host "[OK] Rule already absent: $($r.DisplayName)"
        }
        continue
    }

    try {
        # Idempotent: drop any pre-existing rule with this name, then create the
        # exact desired configuration (avoids drift from manually edited rules).
        if ($existing) {
            $existing | Remove-NetFirewallRule
            Write-Host "[INFO] Existing rule replaced: $($r.DisplayName)"
        }
        New-NetFirewallRule `
            -DisplayName   $r.DisplayName `
            -Description   $r.Description `
            -Direction     Inbound `
            -Action        Allow `
            -Protocol      $r.Protocol `
            -LocalPort     $r.LocalPort `
            -RemoteAddress LocalSubnet `
            -Profile       Any `
            -Enabled       True | Out-Null
        Write-Host "[OK] Rule active: $($r.DisplayName) ($($r.Protocol) $($r.LocalPort), LocalSubnet only)"
    } catch {
        Write-Host "[ERROR] Could not create $($r.DisplayName): $($_.Exception.Message)"
        $failed++
    }
}

if (-not $Remove) {
    Write-Host ''
    Write-Host 'Current state:'
    foreach ($r in $rules) {
        $rule = Get-NetFirewallRule -DisplayName $r.DisplayName -ErrorAction SilentlyContinue
        if ($rule) {
            $pf = $rule | Get-NetFirewallPortFilter
            $af = $rule | Get-NetFirewallAddressFilter
            Write-Host ("  {0,-22} Enabled={1} {2}/{3} Remote={4}" -f `
                $r.DisplayName, $rule.Enabled, $pf.Protocol, $pf.LocalPort, $af.RemoteAddress)
        } else {
            Write-Host "  $($r.DisplayName)  MISSING"
        }
    }
}

# netsh equivalents (reference only — for machines where the NetSecurity module misbehaves):
#   netsh advfirewall firewall add rule name="Fullsite POS Bridge" dir=in action=allow protocol=TCP localport=7717 remoteip=localsubnet
#   netsh advfirewall firewall add rule name="Fullsite mDNS" dir=in action=allow protocol=UDP localport=5353 remoteip=localsubnet
#   netsh advfirewall firewall delete rule name="Fullsite POS Bridge"
#   netsh advfirewall firewall delete rule name="Fullsite mDNS"

exit $(if ($failed -gt 0) { 1 } else { 0 })
