Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType=WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -like 'IAsyncOperation*' } | Select-Object -First 1
$asTask.ToString()
$op = [Windows.Storage.StorageFile]::GetFileFromPathAsync((Resolve-Path 'tmp\pdfs\page-01.jpg').Path)
$task = $asTask.MakeGenericMethod([Windows.Storage.StorageFile]).Invoke($null, @($op)); $task.Wait(); $file=$task.Result
$op=$file.OpenAsync([Windows.Storage.FileAccessMode]::Read); $task=$asTask.MakeGenericMethod([Windows.Storage.Streams.IRandomAccessStream]).Invoke($null,@($op)); $task.Wait(); $stream=$task.Result
$op=[Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream); $task=$asTask.MakeGenericMethod([Windows.Graphics.Imaging.BitmapDecoder]).Invoke($null,@($op)); $task.Wait(); $decoder=$task.Result
$op=$decoder.GetSoftwareBitmapAsync(); $task=$asTask.MakeGenericMethod([Windows.Graphics.Imaging.SoftwareBitmap]).Invoke($null,@($op)); $task.Wait(); $bitmap=$task.Result
$engine=[Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
$op=$engine.RecognizeAsync($bitmap); $task=$asTask.MakeGenericMethod([Windows.Media.Ocr.OcrResult]).Invoke($null,@($op)); $task.Wait(); $result=$task.Result
$result.Text
