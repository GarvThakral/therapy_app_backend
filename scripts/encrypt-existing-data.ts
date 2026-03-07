import { prisma } from "../lib/prisma.js";
import { encryptText, isEncryptedValue } from "../lib/crypto.js";

interface UpdateCounter {
  logs: number;
  homework: number;
  sessions: number;
  profiles: number;
  posts: number;
  comments: number;
  reports: number;
}

function encryptIfNeeded(value: string) {
  return isEncryptedValue(value) ? value : encryptText(value);
}

function encryptNullableIfNeeded(value: string | null) {
  if (value === null) return null;
  return encryptIfNeeded(value);
}

function hasArrayChanges(original: string[], next: string[]) {
  if (original.length !== next.length) return true;
  for (let i = 0; i < original.length; i += 1) {
    if (original[i] !== next[i]) return true;
  }
  return false;
}

async function encryptLogs(counter: UpdateCounter) {
  const logs = await prisma.logEntry.findMany({
    select: { id: true, text: true, prepNote: true },
  });

  for (const log of logs) {
    const nextText = encryptIfNeeded(log.text);
    const nextPrepNote = encryptNullableIfNeeded(log.prepNote);
    if (nextText === log.text && nextPrepNote === log.prepNote) continue;

    await prisma.logEntry.update({
      where: { id: log.id },
      data: {
        text: nextText,
        prepNote: nextPrepNote,
      },
    });

    counter.logs += 1;
  }
}

async function encryptHomework(counter: UpdateCounter) {
  const items = await prisma.homeworkItem.findMany({
    select: { id: true, text: true },
  });

  for (const item of items) {
    const nextText = encryptIfNeeded(item.text);
    if (nextText === item.text) continue;

    await prisma.homeworkItem.update({
      where: { id: item.id },
      data: { text: nextText },
    });

    counter.homework += 1;
  }
}

async function encryptSessions(counter: UpdateCounter) {
  const sessions = await prisma.therapySession.findMany({
    select: {
      id: true,
      topics: true,
      whatStoodOut: true,
      prepItems: true,
      moodWord: true,
    },
  });

  for (const session of sessions) {
    const nextTopics = session.topics.map(encryptIfNeeded);
    const nextPrepItems = session.prepItems.map(encryptIfNeeded);
    const nextWhatStoodOut = encryptIfNeeded(session.whatStoodOut);
    const nextMoodWord = encryptNullableIfNeeded(session.moodWord);

    const changed =
      hasArrayChanges(session.topics, nextTopics) ||
      hasArrayChanges(session.prepItems, nextPrepItems) ||
      session.whatStoodOut !== nextWhatStoodOut ||
      session.moodWord !== nextMoodWord;

    if (!changed) continue;

    await prisma.therapySession.update({
      where: { id: session.id },
      data: {
        topics: nextTopics,
        prepItems: nextPrepItems,
        whatStoodOut: nextWhatStoodOut,
        moodWord: nextMoodWord,
      },
    });

    counter.sessions += 1;
  }
}

async function encryptProfiles(counter: UpdateCounter) {
  const profiles = await prisma.userProfile.findMany({
    select: { id: true, displayName: true, therapistName: true },
  });

  for (const profile of profiles) {
    const nextDisplayName = encryptIfNeeded(profile.displayName);
    const nextTherapistName = encryptNullableIfNeeded(profile.therapistName);

    if (nextDisplayName === profile.displayName && nextTherapistName === profile.therapistName) continue;

    await prisma.userProfile.update({
      where: { id: profile.id },
      data: {
        displayName: nextDisplayName,
        therapistName: nextTherapistName,
      },
    });

    counter.profiles += 1;
  }
}

async function encryptCommunityPosts(counter: UpdateCounter) {
  const posts = await prisma.communityPost.findMany({
    select: { id: true, title: true, body: true },
  });

  for (const post of posts) {
    const nextTitle = encryptIfNeeded(post.title);
    const nextBody = encryptIfNeeded(post.body);
    if (nextTitle === post.title && nextBody === post.body) continue;

    await prisma.communityPost.update({
      where: { id: post.id },
      data: {
        title: nextTitle,
        body: nextBody,
      },
    });

    counter.posts += 1;
  }
}

async function encryptCommunityComments(counter: UpdateCounter) {
  const comments = await prisma.communityComment.findMany({
    select: { id: true, body: true },
  });

  for (const comment of comments) {
    const nextBody = encryptIfNeeded(comment.body);
    if (nextBody === comment.body) continue;

    await prisma.communityComment.update({
      where: { id: comment.id },
      data: { body: nextBody },
    });

    counter.comments += 1;
  }
}

async function encryptCommunityReports(counter: UpdateCounter) {
  const reports = await prisma.communityReport.findMany({
    select: { id: true, details: true },
    where: { details: { not: null } },
  });

  for (const report of reports) {
    if (!report.details) continue;
    const nextDetails = encryptIfNeeded(report.details);
    if (nextDetails === report.details) continue;

    await prisma.communityReport.update({
      where: { id: report.id },
      data: { details: nextDetails },
    });

    counter.reports += 1;
  }
}

async function main() {
  const counter: UpdateCounter = {
    logs: 0,
    homework: 0,
    sessions: 0,
    profiles: 0,
    posts: 0,
    comments: 0,
    reports: 0,
  };

  await encryptLogs(counter);
  await encryptHomework(counter);
  await encryptSessions(counter);
  await encryptProfiles(counter);
  await encryptCommunityPosts(counter);
  await encryptCommunityComments(counter);
  await encryptCommunityReports(counter);

  console.log("Encryption migration complete:");
  console.log(`- logs: ${counter.logs}`);
  console.log(`- homework: ${counter.homework}`);
  console.log(`- sessions: ${counter.sessions}`);
  console.log(`- profiles: ${counter.profiles}`);
  console.log(`- community posts: ${counter.posts}`);
  console.log(`- community comments: ${counter.comments}`);
  console.log(`- community reports: ${counter.reports}`);
}

main()
  .catch(error => {
    console.error("Failed to encrypt existing data", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
