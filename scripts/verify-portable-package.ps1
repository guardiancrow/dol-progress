#Requires -Version 5.1
[CmdletBinding()]
param([string]$ExpectedSourceHead, [string]$CompileRunId, [string]$PackageRunId)
. (Join-Path $PSScriptRoot 'portable-package-safety.ps1')

if (-not ('PortableZipVerifier' -as [type])) {
    # This reader does not use ZipArchive or the generator's member/manifest functions.
    Add-Type -ReferencedAssemblies System.IO.Compression -TypeDefinition @'
using System;
using System.IO;
using System.IO.Compression;
using System.Text;
using System.Collections.Generic;
public static class PortableZipVerifier {
    static void Require(bool ok) { if (!ok) throw new InvalidDataException("Archive or PE contract failed."); }
    static void Range(byte[] b, long p, long n) { Require(p>=0 && n>=0 && p<=b.LongLength-n); }
    static ushort U16(byte[] b,long p) { Range(b,p,2); return BitConverter.ToUInt16(b,(int)p); }
    static uint U32(byte[] b,long p) { Range(b,p,4); return BitConverter.ToUInt32(b,(int)p); }
    static readonly uint[] Table=MakeTable();
    static uint[] MakeTable() { var t=new uint[256]; for(uint i=0;i<256;i++) { uint c=i; for(int j=0;j<8;j++) c=(c&1)!=0 ? 0xedb88320U^(c>>1) : c>>1; t[i]=c; } return t; }
    public static uint Crc(byte[] b) { uint c=0xffffffffU; foreach(byte x in b) c=Table[(c^x)&255]^(c>>8); return c^0xffffffffU; }
    static string Name(byte[] b,long p,int n) { Range(b,p,n); for(int i=0;i<n;i++) Require(b[p+i]>=32 && b[p+i]<127); return Encoding.ASCII.GetString(b,(int)p,n); }
    public static Dictionary<string,byte[]> Read(byte[] b) {
        Require(b.Length>=22 && b.Length<=100663296);
        long end=b.Length-22;
        Require(U32(b,end)==0x06054b50 && U16(b,end+4)==0 && U16(b,end+6)==0 && U16(b,end+8)==5 && U16(b,end+10)==5 && U16(b,end+20)==0);
        long cd=U32(b,end+16), cdSize=U32(b,end+12);
        Require(cd+cdSize==end);
        string[] expected={"DOL-Progress-Manager/LICENSE.txt","DOL-Progress-Manager/README.txt","DOL-Progress-Manager/SHA256SUMS.txt","DOL-Progress-Manager/THIRD-PARTY-NOTICES.txt","DOL-Progress-Manager/dol-progress-manager.exe"};
        long p=cd, nextLocal=0, total=0;
        var result=new Dictionary<string,byte[]>(StringComparer.Ordinal);
        for(int i=0;i<5;i++) {
            Range(b,p,46); Require(U32(b,p)==0x02014b50);
            int nameLength=U16(b,p+28), extra=U16(b,p+30), comment=U16(b,p+32);
            ushort flags=U16(b,p+8), method=U16(b,p+10);
            uint crc=U32(b,p+16), packed=U32(b,p+20), unpacked=U32(b,p+24);
            long local=U32(b,p+42);
            string name=Name(b,p+46,nameLength);
            Require(name==expected[i] && extra==0 && comment==0 && U16(b,p+34)==0 && U16(b,p+36)==0 && U32(b,p+38)==0);
            Require((U16(b,p+4)&255)<=20 && U16(b,p+6)==20 && (flags==0 || flags==0x800) && method==8 && U16(b,p+12)==0 && U16(b,p+14)==33);
            long limit=i==4 ? 67108864 : i==3 ? 16777216 : i==2 ? 4096 : 2097152;
            Require(unpacked>0 && unpacked<=limit && packed>0 && packed<=100663296);
            total+=unpacked; Require(total<=100663296 && local==nextLocal);
            Range(b,local,30); Require(U32(b,local)==0x04034b50 && U16(b,local+4)==20);
            Require(U16(b,local+6)==flags && U16(b,local+8)==method && U16(b,local+10)==0 && U16(b,local+12)==33);
            Require(U32(b,local+14)==crc && U32(b,local+18)==packed && U32(b,local+22)==unpacked && U16(b,local+26)==nameLength && U16(b,local+28)==0);
            Require(Name(b,local+30,nameLength)==name);
            long data=local+30+nameLength; Range(b,data,packed); Require(data+packed<=cd);
            var bytes=new byte[unpacked];
            using(var source=new MemoryStream(b,(int)data,(int)packed,false))
            using(var inflater=new DeflateStream(source,CompressionMode.Decompress)) {
                int offset=0; while(offset<bytes.Length) { int n=inflater.Read(bytes,offset,bytes.Length-offset); Require(n>0); offset+=n; }
                Require(inflater.ReadByte()==-1);
            }
            Require(Crc(bytes)==crc);
            result.Add(name.Substring("DOL-Progress-Manager/".Length),bytes);
            nextLocal=data+packed; p+=46+nameLength;
        }
        Require(p==end && nextLocal==cd);
        return result;
    }
    static long Rva(byte[] b,long table,int sections,uint rva) {
        for(int i=0;i<sections;i++) { long s=table+i*40; uint start=U32(b,s+12), size=U32(b,s+16); if(rva>=start && (long)rva-start<size) { long p=U32(b,s+20)+(long)rva-start; Range(b,p,1); return p; } }
        throw new InvalidDataException("PE resource outside raw sections.");
    }
    static long Child(byte[] b,long root,long directory,uint id,bool directoryExpected) {
        int n=U16(b,directory+12)+U16(b,directory+14); Require(n>0 && n<=256); Range(b,directory+16,n*8);
        for(int i=0;i<n;i++) { long entry=directory+16+i*8; if(U32(b,entry)==id) { uint next=U32(b,entry+4); Require(((next&0x80000000U)!=0)==directoryExpected); return root+(next&0x7fffffffU); } }
        throw new InvalidDataException("PE version resource absent.");
    }
    public static void Pe(byte[] b,string version) {
        Require(b.Length>=512 && U16(b,0)==0x5a4d);
        long pe=U32(b,60); Require(U32(b,pe)==0x4550 && U16(b,pe+4)==0x8664);
        int sections=U16(b,pe+6), optionalSize=U16(b,pe+20); long opt=pe+24, table=opt+optionalSize;
        Require(sections>0 && sections<=96 && optionalSize>=240 && U16(b,opt)==0x20b && U16(b,opt+68)==2 && U32(b,opt+108)>=3);
        Range(b,table,sections*40);
        long root=Rva(b,table,sections,U32(b,opt+128));
        long type=Child(b,root,root,16,true), instance=Child(b,root,type,1,true);
        int languages=U16(b,instance+12)+U16(b,instance+14); Require(languages>0 && languages<=256);
        for(int i=0;i<languages;i++) {
            long descriptor=root+U32(b,instance+16+i*8+4); Range(b,descriptor,16);
            long data=Rva(b,table,sections,U32(b,descriptor)); uint size=U32(b,descriptor+4); Range(b,data,size);
            Require(size>=92 && U16(b,data)>=92 && U16(b,data)<=size && U16(b,data+2)==52 && U16(b,data+4)==0);
            Require(Encoding.Unicode.GetString(b,(int)data+6,32)=="VS_VERSION_INFO\0");
            long fixedInfo=(data+6+32+3)&~3L;
            Require(U32(b,fixedInfo)==0xfeef04bd);
            uint ms=U32(b,fixedInfo+8), ls=U32(b,fixedInfo+12), pms=U32(b,fixedInfo+16), pls=U32(b,fixedInfo+20);
            string actual=(ms>>16)+"."+(ms&65535)+"."+(ls>>16);
            Require(actual==version && (ls&65535)==0 && pms==ms && pls==ls);
        }
    }
}
'@
}

function Test-PortableArchive([string]$ZipPath, [string]$ExternalHashPath, [string]$VerifyRoot, $ExpectedHashes,
    [string]$Version, $Payload, $Prefixes) {
    $zipBytes=Read-PortableBytes $ZipPath
    $members=[PortableZipVerifier]::Read($zipBytes)
    # Independent manifest parser: never call the generator's manifest builder.
    $manifest=(New-Object Text.UTF8Encoding($false,$true)).GetString($members['SHA256SUMS.txt'])
    $names=@('LICENSE.txt','README.txt','THIRD-PARTY-NOTICES.txt','dol-progress-manager.exe')
    $lines=$manifest.Split([char]10)
    if ($lines.Count -ne 5 -or $lines[4] -cne '' -or $manifest.Contains("`r") -or $manifest.Contains([char]0xfeff)) { throw 'Manifest: encoding or line ending.' }
    for ($i=0;$i -lt 4;$i++) {
        if ($lines[$i] -cnotmatch ('^[0-9a-f]{64}  '+[regex]::Escape($names[$i])+'$') -or $lines[$i].Substring(0,64) -cne (Get-ReleaseSHA256 $members[$names[$i]])) { throw 'Manifest: grammar or hash mismatch.' }
    }
    if ($ExpectedHashes.Count -ne 5) { throw 'Verification: expected staged hashes missing.' }
    foreach ($name in $members.Keys) {
        if (-not $ExpectedHashes.Contains($name) -or (Get-ReleaseSHA256 $members[$name]) -cne $ExpectedHashes[$name]) { throw 'Verification: staging mismatch.' }
    }
    foreach ($name in $names) {
        if ((Get-ReleaseSHA256 $members[$name]) -cne (Get-ReleaseSHA256 $Payload[$name])) { throw 'Verification: source payload mismatch.' }
    }
    [PortableZipVerifier]::Pe($members['dol-progress-manager.exe'],$Version)
    $readme=$members['README.txt']
    if ($readme.Length -lt 3 -or $readme[0] -ne 239 -or $readme[1] -ne 187 -or $readme[2] -ne 191) { throw 'README: BOM absent.' }
    $readmeText=Get-PortableText $readme
    if ($readmeText -match '(?<!\r)\n|\r(?!\n)' -or -not $readmeText.EndsWith("`r`n")) { throw 'README: CRLF required.' }
    Assert-PortableReadme $readmeText
    if (-not $readmeText.StartsWith('Application version: '+$Version+"`r`n`r`n",[StringComparison]::Ordinal)) { throw 'README: source version mismatch.' }
    if ($null -ne $ExternalHashPath -and $ExternalHashPath -ne '') {
        $external=(New-Object Text.UTF8Encoding($false,$true)).GetString((Read-PortableBytes $ExternalHashPath 4096))
        $expected=(Get-ReleaseSHA256 $zipBytes)+'  '+[IO.Path]::GetFileName($ZipPath)+"`n"
        if ($external -cne $expected) { throw 'Archive: external hash mismatch.' }
    }
    # All ZIP structure, CRC, manifest and document gates above run BEFORE any extraction.
    Assert-ReleaseNoReparse $VerifyRoot
    New-Item -ItemType Directory -Path $VerifyRoot -ErrorAction Stop | Out-Null
    $root=Join-Path $VerifyRoot 'DOL-Progress-Manager'
    New-Item -ItemType Directory -Path $root -ErrorAction Stop | Out-Null
    foreach ($name in $members.Keys) {
        $path=Join-Path $root $name
        Write-PortableBytes $VerifyRoot $path $members[$name]
        Assert-ReleasePrivacy (Test-PrivacyArtifact $path $Prefixes ('payload-'+[Array]::IndexOf([string[]]@('LICENSE.txt','README.txt','SHA256SUMS.txt','THIRD-PARTY-NOTICES.txt','dol-progress-manager.exe'),$name)))
        if ((Get-ReleaseSHA256 (Read-PortableBytes $path)) -cne $ExpectedHashes[$name]) { throw 'Extraction: hash mismatch.' }
    }
    return [pscustomobject]@{members=5;crc_verified=5;extracted_hashes_verified=5;sha256=(Get-ReleaseSHA256 $zipBytes);version=$Version;privacy='PASS';classification='PACKAGE_VERIFIED'}
}

if ($MyInvocation.InvocationName -ne '.') {
    $ErrorActionPreference='Stop'; $run=$null; $gate='Notices'; $exitCode=1
    try {
        $root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
        Assert-PortableNoticeAvailability $root
        $gate='Source'; $source=Get-PortableSource $root $ExpectedSourceHead
        $notices=Read-PortableNotices $root $source.Version $source.Hashes
        $prefixes=Get-PrivacyPrefixes $root ''
        $gate='Compile'; $exe=Get-PortableCompile $root $CompileRunId $source $prefixes
        if ($PackageRunId -notmatch '^[0-9a-f]{32}$') { throw 'Package: invalid identifier.' }
        $package=Join-Path $root ('tmp/portable-release/'+$PackageRunId)
        Assert-ReleaseContained $root $package; Assert-ReleaseNoReparse $package
        $owner=Get-PortableText (Read-PortableBytes (Join-Path $package 'ownership.json')) | ConvertFrom-Json
        if ($owner.schema -ne 1 -or $owner.run_id -cne $PackageRunId -or $owner.source_head -cne $source.Head -or $owner.compile_run_id -cne $CompileRunId -or $owner.purpose -cne 'portable package verification') { throw 'Package: ownership mismatch.' }
        $packageResult=Get-PortableText (Read-PortableBytes (Join-Path $package 'result.json')) | ConvertFrom-Json
        $basename='DOL-Progress-Manager_'+$source.Version+'_windows-x64_portable.zip'
        if ($packageResult.classification -cne 'PACKAGE_VERIFIED' -or $packageResult.exit_code -ne 0 -or $packageResult.source_head -cne $source.Head -or
            $packageResult.version -cne $source.Version -or $packageResult.compile_run_id -cne $CompileRunId -or $packageResult.package_run_id -cne $PackageRunId -or
            $packageResult.zip -cne $basename -or $packageResult.zip_sha256 -notmatch '^[0-9a-f]{64}$') { throw 'Package: missing or failed result.' }
        $payload=[ordered]@{'LICENSE.txt'=(Read-PortableBytes (Join-Path $root 'LICENSE'));'README.txt'=(ConvertTo-PortableReadme (Read-PortableBytes (Join-Path $root 'README.md')) $source.Version);'THIRD-PARTY-NOTICES.txt'=$notices;'dol-progress-manager.exe'=$exe}
        $hashes=[ordered]@{}
        $stagedNames=@(Get-ChildItem -LiteralPath (Join-Path $package 'staging/DOL-Progress-Manager') -Force | ForEach-Object { $_.Name })
        if (Compare-Object @('LICENSE.txt','README.txt','SHA256SUMS.txt','THIRD-PARTY-NOTICES.txt','dol-progress-manager.exe') $stagedNames) { throw 'Package: extra staged input.' }
        foreach ($name in @('LICENSE.txt','README.txt','SHA256SUMS.txt','THIRD-PARTY-NOTICES.txt','dol-progress-manager.exe')) { $hashes[$name]=Get-ReleaseSHA256 (Read-PortableBytes (Join-Path $package ('staging/DOL-Progress-Manager/'+$name))) }
        $run=New-PortablePackageRun $root $source.Head $CompileRunId
        $prefixes['PackageRoot']=$package; $prefixes['VerificationRoot']=$run.Path
        $zip=Join-Path $package ('output/DOL-Progress-Manager_'+$source.Version+'_windows-x64_portable.zip')
        $gate='Verification'; $verified=Test-PortableArchive $zip ($zip+'.sha256') (Join-Path $run.Verify 'extracted') $hashes $source.Version $payload $prefixes
        if ($verified.sha256 -cne $packageResult.zip_sha256) { throw 'Package: recorded archive hash mismatch.' }
        $namesPath=Join-Path $run.Logs 'member-names.txt'
        Write-ReleaseNewText $namesPath "DOL-Progress-Manager/LICENSE.txt`nDOL-Progress-Manager/README.txt`nDOL-Progress-Manager/SHA256SUMS.txt`nDOL-Progress-Manager/THIRD-PARTY-NOTICES.txt`nDOL-Progress-Manager/dol-progress-manager.exe`n"
        Assert-ReleasePrivacy (Test-PrivacyArtifact $namesPath $prefixes 'member-names')
        Assert-ReleasePrivacy (Test-PrivacyArtifact (Join-Path $package 'logs/package.txt') $prefixes 'package-log')
        Assert-PortableSourceUnchanged $root $source
        Write-ReleaseNewText (Join-Path $run.Path 'result.json') (($verified | ConvertTo-Json)+"`n")
        Write-Output "VerificationRun=$($run.Id) PackageIntegrity=PASS PublicRelease=NOT_AUTHORIZED"
        $exitCode=0
    } catch {
        if ($null -ne $run) {
            try { Write-ReleaseNewText (Join-Path $run.Path 'result.json') (([ordered]@{classification='FAILED';gate=$gate} | ConvertTo-Json)+"`n") }
            catch { [Console]::Error.WriteLine('Package verification FAILED Gate=Result') }
        }
        [Console]::Error.WriteLine("Package verification FAILED Gate=$gate")
    }
    exit $exitCode
}
