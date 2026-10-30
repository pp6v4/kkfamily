// Reproducible local line icons. Run with sharp available in NODE_PATH.
const fs=require('node:fs'),path=require('node:path'),sharp=require('sharp');
const icons={
  family:'<circle cx="8" cy="7" r="3"/><circle cx="17" cy="8" r="2.5"/><path d="M2 21v-3a6 6 0 0 1 12 0v3M16 14a5 5 0 0 1 6 5v2"/>',
  task:'<rect x="4" y="4" width="16" height="17" rx="3"/><path d="M9 4V2h6v2M8 12l3 3 5-6"/>',
  idea:'<path d="M8 16c0-3-3-3-3-7a7 7 0 0 1 14 0c0 4-3 4-3 7M8 17h8M9 21h6"/>',
  archive:'<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M3 7V3h18v4M9 11h6"/>',
  chart:'<path d="M4 3v18h17M8 17v-5M13 17V7M18 17v-8"/>',
  bell:'<path d="M5 10a7 7 0 0 1 14 0v5l2 3H3l2-3zM9 21h6"/>',
  settings:'<path d="M4 5h16M4 12h16M4 19h16"/><circle cx="9" cy="5" r="2" fill="currentColor"/><circle cx="16" cy="12" r="2" fill="currentColor"/><circle cx="8" cy="19" r="2" fill="currentColor"/>',
  shield:'<path d="M12 2l9 4v6c0 6-9 10-9 10S3 18 3 12V6zM8 12l3 3 5-6"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 2v6M17 2v6M3 10h18M7 14h3M14 14h3M7 18h3"/>',
  bowl:'<path d="M2 11h20a10 10 0 0 1-20 0zM8 21h8M8 2v5M12 3v4M16 2v5"/>',
  tent:'<path d="M2 21L12 3l10 18zM8 21l4-8 4 8M10 2l2 1 2-1"/>',
  bag:'<path d="M4 7h16l1 14H3zM8 9V6a4 4 0 0 1 8 0v3"/>',
  home:'<path d="M2 11L12 2l10 9M5 9v12h5v-7h4v7h5V9"/>'
};
const dest=path.resolve(__dirname,'../apps/client/src/static/icons');
async function main(){fs.mkdirSync(dest,{recursive:true});for(const [name,body]of Object.entries(icons))for(const [suffix,color]of [['','#667267'],['-active','#38674f']]){
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 28 28"><g transform="translate(2 2)" fill="none" stroke="${color}" color="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${body}</g></svg>`;
 await sharp(Buffer.from(svg)).png().toFile(path.join(dest,name+suffix+'.png'));
}console.log('26 icons generated from 13 local vectors');}
main().catch(error=>{console.error(error);process.exitCode=1;});
