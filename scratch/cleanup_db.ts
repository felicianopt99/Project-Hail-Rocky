import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Cleaning up database...");
  await prisma.message.deleteMany({});
  await prisma.memory.deleteMany({});
  await prisma.log.deleteMany({});
  console.log("Database cleaned!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
