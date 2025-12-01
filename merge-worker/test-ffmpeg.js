import ffmpegPath from 'ffmpeg-static';
import ffmpeg from 'fluent-ffmpeg';
ffmpeg.setFfmpegPath(ffmpegPath);
console.log('ffmpeg path ->', ffmpegPath);
ffmpeg().on('error', (err)=>{ console.error('ffmpeg error', err); })
       .on('end', ()=>{ console.log('ffmpeg ok (no-op)'); })
       .inputOptions('-version')
       .saveToFile('ffmpeg_dummy_output.txt');
