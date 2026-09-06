// Reuses the existing PinCon OCR proxy's image/text contract. No provider secret.
export async function noticePhotoText(file) {
  if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 10*1024*1024) throw new Error("10MB 이하 JPG·PNG·WebP 사진을 선택해주세요.");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1,1800/Math.max(bitmap.width,bitmap.height));
  const canvas=document.createElement("canvas"); canvas.width=Math.round(bitmap.width*scale); canvas.height=Math.round(bitmap.height*scale);
  const context=canvas.getContext("2d"); context.fillStyle="#fff"; context.fillRect(0,0,canvas.width,canvas.height); context.drawImage(bitmap,0,0,canvas.width,canvas.height); bitmap.close();
  const controller = new AbortController(); const timer=setTimeout(()=>controller.abort(),25000);
  try {
    const response=await fetch(globalThis.PINCON_OCR_ENDPOINT || "https://pine-lime.vercel.app/api/ocr", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({image:canvas.toDataURL("image/jpeg",.82)}), signal:controller.signal });
    const payload=await response.json();
    if(!response.ok || !payload.text) throw new Error("사진의 글자를 읽지 못했습니다. 다른 사진으로 다시 시도해주세요.");
    return String(payload.text);
  } catch(error) { if(error.name === "AbortError") throw new Error("사진 인식 응답이 늦습니다. 잠시 후 다시 시도해주세요."); throw error; }
  finally { clearTimeout(timer); }
}
