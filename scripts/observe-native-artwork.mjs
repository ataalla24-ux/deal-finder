import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {artworkInputHash} from './native-contract-observation.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const android = 'FreeFinderWien-Android/app/src/main/java/com/stefanataalla/freefinderwien/';
function between(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert(a >= 0 && b > a && source.indexOf(start, a + start.length) < 0, `Native source boundary changed: ${start}`);
  return source.slice(a, b);
}

// Compile the actual presentation helpers, not a JavaScript approximation of their rules.
export async function observeNativeArtwork({root=process.cwd(), nativeRoot, now=new Date(), sharpModule=process.env.SHARP_MODULE || 'sharp'}={}) {
  if (!nativeRoot) throw Error('Explicit native checkout required');
  const {default:sharp} = await import(sharpModule);
  const deals = JSON.parse(fs.readFileSync(path.join(root,'docs/deals.json'),'utf8')).deals;
  assert(Array.isArray(deals));
  const sourceHashes = {};
  const read = file => {
    const bytes = fs.readFileSync(path.join(nativeRoot,file)); sourceHashes[file] = hash(bytes); return bytes.toString('utf8');
  };
  const swiftUI = read('FreeFinderWien/ContentView.swift');
  const kotlinModels = read(android+'NativeDealModels.kt');
  const files = ['FreeFinderWien/DealsHomeArtwork.swift','FreeFinderWien/DealCardText.swift','FreeFinderWien/ViennaStreetAddress.swift',
    android+'DealsHomeArtwork.kt',android+'DealCardText.kt',android+'ViennaStreetAddress.kt',android+'ApprovedDealPhoto.kt',
    'FreeFinderWien/DealsHomeStyle.swift',android+'MainActivity.kt',android+'FreeFinderShareSheet.kt'];
  for(const file of files) read(file);
  assert.match(swiftUI, /NativeDealDisplayText\.cleanBrand\(DealCardText\.merchant\(brand\), title: title\)/);
  assert.match(kotlinModels, /val publicBrand = DealCardText\.merchant\(brand\)\s+if \(publicBrand\.isBlank\(\)\) "" else DealDisplayText\.cleanBrand\(publicBrand, title\)/);
  assert.match(read('FreeFinderWien/DealsHomeStyle.swift'), /\.aspectRatio\(2\.7, contentMode: \.fit\)/);
  assert.match(read(android+'MainActivity.kt'), /val height = \(width \/ 2\.7f\)\.toInt\(\)\.coerceAtLeast\(1\)/);
  assert.match(swiftUI, /title: \$0\.displayTitle, category: \$0\.category, merchant: \$0\.displayBrand/);
  assert.match(swiftUI, /DealCardText\.title\(NativeDealDisplayText\.cleanTitle\(title, brand: displayBrand\), brand: brand, description: description\)/);
  assert.match(kotlinModels, /DealCardText\.title\(DealDisplayText\.cleanTitle\(title, displayBrand\), if \(DealCardText\.publicText\(brand\) != DealCardText\.clean\(brand\)\) brand else displayBrand, description\)/);
  const swiftHelpers = between(swiftUI,'private enum NativeDealDisplayText {','    static func cleanDescription(') + '}\n' +
    between(swiftUI,'private func normalized(_ value: String?) -> String {','private struct NativeWebLoadingView:');
  const kotlinHelpers = 'private object DealDisplayText {\n' + between(kotlinModels,'    fun cleanBrand(raw: String, title: String): String {','    fun cleanPlace(') +
    between(kotlinModels,'    private fun cleanBase(raw: String): String =','    private fun descriptionKey(') + '}\n' +
    between(kotlinModels,'fun normalized(value: String?): String {','fun containsAny(') +
    between(kotlinModels,'private fun repairMojibake(value: String): String {','private object DealDisplayText {') +
    ['COMBINING_DIACRITICS_REGEX','MOJIBAKE_NOISE_REGEX'].map(name=>kotlinModels.split('\n').find(line=>line.startsWith('private val '+name+' ='))).join('\n');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),'ff-native-observation-'));
  const put = (file, value) => fs.writeFileSync(path.join(temp,file),value);
  const literal = value => JSON.stringify(String(value || '')).replace(/\$/g,'\\$');
  try {
    put('input.json',JSON.stringify(deals));
    put('Observe.swift',`import Foundation
${swiftHelpers}
@main enum Observe {
 static func main() throws {
  let rows = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))) as! [[String: Any]]
  let entries = rows.map { row -> DealsHomeArtwork.Entry in
   let rawBrand = row["brand"] as? String ?? "", rawTitle = row["title"] as? String ?? ""
   let brand = NativeDealDisplayText.cleanBrand(DealCardText.merchant(rawBrand), title: rawTitle)
   let title = DealCardText.title(NativeDealDisplayText.cleanTitle(rawTitle, brand: brand), brand: rawBrand, description: row["description"] as? String ?? "")
   return .init(id: row["id"] as! String, title: title, category: row["category"] as? String, merchant: brand)
  }
  let assigned = DealsHomeArtwork.assignments(entries)
  precondition(assigned == DealsHomeArtwork.assignments(entries.reversed()))
  precondition(assigned == DealsHomeArtwork.assignments(entries, previous: assigned))
  let output: [[Any]] = entries.map { [$0.id, $0.title, $0.merchant, DealsHomeArtwork.candidates(for: $0), assigned[$0.id]!] }
  FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: output))
 }
}`);
    put('Observe.kt',`package com.stefanataalla.freefinderwien
import java.util.Locale
import java.text.Normalizer
${kotlinHelpers}
fun quoted(value: String): String = "\\\"" + value.replace("\\\\", "\\\\\\\\").replace("\\\"", "\\\\\\\"").replace("\\n", "\\\\n").replace("\\r", "\\\\r").replace("\\t", "\\\\t") + "\\\""
fun main() {
 val raw = listOf(${deals.map(d=>`listOf(${[d.id,d.title,d.brand,d.description,d.category].map(literal).join(',')})`).join(',\n')})
 val entries = raw.map { row ->
  val publicBrand = DealCardText.merchant(row[2])
  val brand = if (publicBrand.isBlank()) "" else DealDisplayText.cleanBrand(publicBrand, row[1])
  val title = DealCardText.title(DealDisplayText.cleanTitle(row[1], brand), if (DealCardText.publicText(row[2]) != DealCardText.clean(row[2])) row[2] else brand, row[3])
  DealsHomeArtwork.Entry(row[0], title, row[4], brand)
 }
 val assigned = DealsHomeArtwork.assignments(entries)
 check(assigned == DealsHomeArtwork.assignments(entries.reversed()))
 check(assigned == DealsHomeArtwork.assignments(entries, assigned))
 println(entries.joinToString(prefix="[",postfix="]") { "["+quoted(it.id)+","+quoted(it.title)+","+quoted(it.merchant)+","+DealsHomeArtwork.candidates(it).joinToString(prefix="[",postfix="]")+","+assigned.getValue(it.id)+"]" })
}`);
    execFileSync('swiftc',['FreeFinderWien/DealsHomeArtwork.swift','FreeFinderWien/DealCardText.swift','FreeFinderWien/ViennaStreetAddress.swift',path.join(temp,'Observe.swift'),'-o',path.join(temp,'observe')],{cwd:nativeRoot,stdio:'pipe',timeout:120000});
    const cache=path.join(os.homedir(),'.gradle/caches/modules-2/files-2.1');
    function jar(group,name,version) {
      const base=path.join(cache,group,name,version);
      const file=fs.readdirSync(base).flatMap(d=>fs.readdirSync(path.join(base,d)).map(f=>path.join(base,d,f))).find(f=>f.endsWith(`/${name}-${version}.jar`));
      assert(file,`Cached compiler dependency missing: ${name}`); return file;
    }
    const deps=[jar('org.jetbrains.kotlin','kotlin-compiler-embeddable','2.2.10'),jar('org.jetbrains.kotlin','kotlin-stdlib','2.2.10'),
      jar('org.jetbrains.kotlin','kotlin-script-runtime','2.2.10'),jar('org.jetbrains.kotlin','kotlin-reflect','1.6.10'),
      jar('org.jetbrains','annotations','13.0'),jar('org.jetbrains.kotlinx','kotlinx-coroutines-core-jvm','1.8.0')].join(path.delimiter);
    const java='/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/java';
    execFileSync(java,['-Xmx384m','-cp',deps,'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler','-no-stdlib','-no-reflect','-classpath',deps,'-d',path.join(temp,'classes'),
      ...['DealsHomeArtwork.kt','DealCardText.kt','ViennaStreetAddress.kt'].map(f=>path.join(nativeRoot,android,f)),path.join(temp,'Observe.kt')],{stdio:'pipe',timeout:120000});
    const ios=JSON.parse(execFileSync(path.join(temp,'observe'),[path.join(temp,'input.json')],{encoding:'utf8',timeout:30000}));
    const droid=JSON.parse(execFileSync(java,['-Xmx128m','-cp',path.join(temp,'classes')+path.delimiter+deps,'com.stefanataalla.freefinderwien.ObserveKt'],{encoding:'utf8',timeout:30000}));
    const destination=path.join(root,'reviews/native-artwork'); fs.mkdirSync(destination,{recursive:true});
    const media={};
    async function asset(platform,index) {
      const key=`${platform}-${index}`; if(media[key])return media[key];
      let iosName,androidName,columns=1,start=index;
      if(index<4){iosName='DealsHomeFood';androidName='deals-home-food.jpg';columns=2;start=0;}
      else if(index<20){iosName='DealsHomeTopics';androidName='deals-home-topics.jpg';columns=4;start=4;}
      else if(index<84){const i=Math.floor((index-20)/16),letter='ABCD'[i];iosName='DealsHomeVariety'+letter;androidName=`deals-home-variety-${letter.toLowerCase()}.jpg`;columns=4;start=20+16*i;}
      else {iosName='DealsHomeSpecific'+index;androidName=index<88?`deals-home-${['kaiserschmarrn','cheesecake','durum','gelato'][index-84]}.jpg`:`deals-home-specific-${index}.${index<120?'webp':'jpg'}`;}
      const set=path.join('FreeFinderWien/Assets.xcassets',iosName+'.imageset');
      const contents=JSON.parse(fs.readFileSync(path.join(nativeRoot,set,'Contents.json'),'utf8'));
      const source=platform==='ios'?path.join(set,contents.images.find(i=>i.filename)?.filename):'FreeFinderWien-Android/app/src/main/assets/'+androidName;
      const bytes=fs.readFileSync(path.join(nativeRoot,source)),meta=await sharp(bytes).metadata();
      const cell=index-start,col=cell%columns,row=Math.floor(cell/columns);
      const left=Math.floor(col*meta.width/columns),top=Math.floor(row*meta.height/columns);
      const crop={left,top,width:Math.floor((col+1)*meta.width/columns)-left,height:Math.floor((row+1)*meta.height/columns)-top};
      const extracted=await sharp(bytes).extract(crop).resize({width:1200,height:1200,fit:'inside',withoutEnlargement:true}).webp({quality:90}).toBuffer();
      const card=await sharp(bytes).extract(crop).resize({width:1080,height:400,fit:'cover',position:'centre'}).webp({quality:90}).toBuffer();
      const writeAsset=data=>{const sha256=hash(data),file=`${sha256}.webp`;if(!fs.existsSync(path.join(destination,file)))fs.writeFileSync(path.join(destination,file),data,{flag:'wx'});return {file:`reviews/native-artwork/${file}`,sha256};};
      return media[key]={platform,index,source,sourceSha256:hash(bytes),crop,full:writeAsset(extracted),card:writeAsset(card),
        kind:'existing-bundled-symbolic-artwork',reviewCopy:'bounded-WebP-derivative',merchantOriginal:false};
    }
    const entries=[];
    for(let i=0;i<deals.length;i++){
      const byPlatform={};
      for(const [platform,rows] of [['ios',ios],['android',droid]]){
        const [id,title,brand,candidates,assigned]=rows[i]; assert.equal(id,deals[i].id);
        byPlatform[platform]={title,brand,candidates,assigned,asset:await asset(platform,assigned)};
      }
      entries.push({id:deals[i].id,...byPlatform,selectionParity:JSON.stringify(ios[i].slice(3))===JSON.stringify(droid[i].slice(3))});
    }
    const report={version:1,checkedAt:now.toISOString(),artworkInputHash:artworkInputHash(deals),sourceHashes,entries,
      displayTransformationsTested:true,selectionMode:'fresh-whole-feed-canonical',
      persistedAssignmentsNotExhaustive:true,recipientUiTest:false,nativeAppLaunched:false,
      caveats:['Actual compiled Swift/Kotlin presentation and selection; not a handset render or installed-version audit.',
        'A minimum original-pixel check is separate from semantic review; upscaled crops do not recover detail.',
        'Card crop models 2.7:1 center fill. Full image is the bundled photo-share payload, not proof that a recipient app accepts it.',
        'Previously cached assignments can choose other candidates. A changed artwork-input feed invalidates this observation.']};
    fs.writeFileSync(path.join(root,'reviews/native-artwork-observation.json'),JSON.stringify(report,null,2)+'\n');
    return report;
  } finally {fs.rmSync(temp,{recursive:true,force:true});}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const index=process.argv.indexOf('--native-root');
  const result=await observeNativeArtwork({nativeRoot:index>=0?process.argv[index+1]:null});
  console.log(JSON.stringify({deals:result.entries.length,selectionMismatches:result.entries.filter(r=>!r.selectionParity).map(r=>r.id),displayTransformationsTested:true,nativeAppLaunched:false}));
}
