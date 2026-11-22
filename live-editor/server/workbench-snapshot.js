import { savedWorkbenchTheme } from '../shared/workbench-theme.js';
import { exportedJobFile } from './output-names.js';
import { directories } from './directories.js';
import { chatRate } from './chat-rules.js';
import { savedGiftStyle } from '../shared/gifts.js';
import { savedDanmakuStyle } from '../shared/danmaku-style.js';
import { savedRecordingStyle } from '../shared/recording-style.js';
import { savedHighlightStyle } from '../shared/highlight-style.js';
import { savedTimestampStyle, savedTimestampPosition } from '../shared/timestamp-style.js';

export function workbenchSettings(store,media,closeAction,previewTimestamp){return {
  workbenchTheme:savedWorkbenchTheme(store),paths:directories(store),closeAction:closeAction(),previewTimestamp:previewTimestamp(),
  previewTimestampStyle:savedTimestampStyle(store),previewTimestampPosition:savedTimestampPosition(store),
  recordingStyle:savedRecordingStyle(store),giftStyle:savedGiftStyle(store),danmakuPerSecond:chatRate(store),
  danmakuStyle:savedDanmakuStyle(store),highlightStyle:savedHighlightStyle(store),danmakuFont:media.fonts.snapshot()
};}

export function workbenchSnapshot({store,recorder,diagnostics,updates,preparation,deletingSessions,root,settingsSnapshot,credentialWarnings}){return {credentialWarnings,recovery:{...store.recovery,isolatedRecords:store.recoveryCount},diagnostics:{error:diagnostics.lastError},updates:updates.snapshot(),sessions:recorder.materialOrigins(store.sessions()),rooms:recorder.rooms,anchors:recorder.anchors,following:recorder.douyin.followingSnapshot,recorder:recorder.statusSnapshot(),preparation:preparation.snapshot(),jobs:jobSummaries(store,store.all(`WITH visible AS (SELECT jobs.*,jobs.rowid AS seq FROM jobs LEFT JOIN sessions ON sessions.id=jobs.session WHERE jobs.session IS NULL OR sessions.deleted_at=''), history AS (SELECT * FROM visible WHERE status IN ('done','cancelled','canceled') ORDER BY created DESC,seq ASC LIMIT 100) SELECT * FROM visible WHERE status NOT IN ('done','cancelled','canceled') UNION ALL SELECT * FROM history ORDER BY created DESC,seq ASC`)),deletions:deletingSessions.snapshot(),pendingCleanup:store.pendingCleanup(),retainedCleanup:store.retainedCleanup?.()||[],dataPath:root,...settingsSnapshot()};}

export function jobSummaries(store,rows){return rows.map(job=>{const {data,seq,...entry}=job,details=store.jobDetails(job);return {...entry,...(details.autoPost?{autoPostExport:true}:{}),scope:details.scope||'clips',clipIndex:details.clipIndex,clipCount:details.clipCount,danmaku_file:exportedJobFile(job,'danmaku')||'',canRetrySave:details.canRetrySave===true,canRetryExport:['failed','interrupted','save_failed'].includes(job.status)&&!details.recoveryInvalid,hasProcessingRecovery:!!details.processingRecovery,savedExportSteps:details.processingRecovery?.completedSteps||0,hasRetainedFiles:!!(details.processingRecovery||details.pendingPublication),automaticRetries:details.automaticRetries||0,resumedExportSteps:details.resumedExportSteps||0,exportDirectory:details.outputRoot||''};});}
