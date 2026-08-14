param(
  [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\src\apluno\assets')
)

$resolvedRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$targetPath = [System.IO.Path]::GetFullPath($OutputDirectory)
if (-not $targetPath.StartsWith($resolvedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "La salida debe permanecer dentro del repositorio: $targetPath"
}

Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Force -Path $targetPath | Out-Null

function New-AplunoIcon {
  param([int]$Size, [string]$FileName)

  $bitmap = [System.Drawing.Bitmap]::new($Size, $Size)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#11130F'))

  $fontSize = [Math]::Round($Size * 0.55)
  $font = [System.Drawing.Font]::new('Segoe UI', $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $format = [System.Drawing.StringFormat]::new()
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center
  $white = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#FFFDF7'))
  $graphics.DrawString('A', $font, $white, [System.Drawing.RectangleF]::new(0, -($Size * 0.025), $Size, $Size), $format)

  $blue = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#315BF5'))
  $barWidth = [Math]::Max(3, [Math]::Round($Size * 0.16))
  $barHeight = [Math]::Max(2, [Math]::Round($Size * 0.035))
  $graphics.FillRectangle($blue, [Math]::Round(($Size - $barWidth) / 2), [Math]::Round($Size * 0.82), $barWidth, $barHeight)

  $output = Join-Path $targetPath $FileName
  $bitmap.Save($output, [System.Drawing.Imaging.ImageFormat]::Png)

  $blue.Dispose()
  $white.Dispose()
  $format.Dispose()
  $font.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()
}

New-AplunoIcon -Size 32 -FileName 'favicon-32.png'
New-AplunoIcon -Size 192 -FileName 'icon-192.png'
New-AplunoIcon -Size 512 -FileName 'icon-512.png'
Write-Output "Iconos Apluno generados en $targetPath"
