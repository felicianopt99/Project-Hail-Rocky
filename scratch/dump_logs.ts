import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function dumpLogs() {
  const logs = await prisma.log.findMany({
    orderBy: { timestamp: "desc" },
    take: 50
  });

  console.log("--- SYSTEM LOGS (Latest 50) ---");
  logs.reverse().forEach(log => {
    console.log(`[${log.timestamp.toISOString()}] ${log.message}`);
  });
  
  const messages = await prisma.message.findMany({
    orderBy: { timestamp: "desc" },
    take: 10
  });
  
  console.log("\n--- RECENT CHAT MESSAGES ---");
  messages.reverse().forEach(m => {
    console.log(`[${m.role}] ${m.text}`);
  });

  await prisma.$disconnect();
}

dumpLogs();
