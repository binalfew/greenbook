import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function addAdminUser(email) {
  try {
    // First, find the user by email
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!user) {
      console.error(`❌ User with email "${email}" not found`);
      console.log("Available users:");
      const allUsers = await prisma.user.findMany({
        select: { email: true, name: true, createdAt: true },
      });
      allUsers.forEach((u) => {
        console.log(
          `  - ${u.email} (${
            u.name || "No name"
          }) - Created: ${u.createdAt.toISOString()}`
        );
      });
      return;
    }

    // Check if user is already an admin
    const existingAdmin = await prisma.adminUser.findUnique({
      where: { userId: user.id },
    });

    if (existingAdmin) {
      console.log(`ℹ️  User "${email}" is already an admin`);
      return;
    }

    // Add admin privileges
    const adminUser = await prisma.adminUser.create({
      data: {
        userId: user.id,
      },
    });

    console.log(`✅ Successfully added admin privileges to "${email}"`);
    console.log(`   Admin ID: ${adminUser.id}`);
    console.log(`   User ID: ${user.id}`);
    console.log(`   Created at: ${adminUser.createdAt.toISOString()}`);
  } catch (error) {
    console.error("❌ Error adding admin user:", error);
  } finally {
    await prisma.$disconnect();
  }
}

async function listAdminUsers() {
  try {
    const adminUsers = await prisma.adminUser.findMany({
      include: {
        user: {
          select: { email: true, name: true },
        },
      },
    });

    if (adminUsers.length === 0) {
      console.log("No admin users found");
      return;
    }

    console.log("Current admin users:");
    adminUsers.forEach((admin) => {
      console.log(
        `  - ${admin.user.email} (${
          admin.user.name || "No name"
        }) - Admin since: ${admin.createdAt.toISOString()}`
      );
    });
  } catch (error) {
    console.error("❌ Error listing admin users:", error);
  } finally {
    await prisma.$disconnect();
  }
}

async function removeAdminUser(email) {
  try {
    // First, find the user by email
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!user) {
      console.error(`❌ User with email "${email}" not found`);
      return;
    }

    // Check if user is an admin
    const existingAdmin = await prisma.adminUser.findUnique({
      where: { userId: user.id },
    });

    if (!existingAdmin) {
      console.log(`ℹ️  User "${email}" is not an admin`);
      return;
    }

    // Remove admin privileges
    await prisma.adminUser.delete({
      where: { userId: user.id },
    });

    console.log(`✅ Successfully removed admin privileges from "${email}"`);
  } catch (error) {
    console.error("❌ Error removing admin user:", error);
  } finally {
    await prisma.$disconnect();
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const command = args[0];
const email = args[1];

if (!command) {
  console.log("Usage:");
  console.log(
    "  node add-admin-user.js add <email>     - Add admin privileges to user"
  );
  console.log(
    "  node add-admin-user.js remove <email>  - Remove admin privileges from user"
  );
  console.log(
    "  node add-admin-user.js list            - List all admin users"
  );
  process.exit(1);
}

switch (command) {
  case "add":
    if (!email) {
      console.error("❌ Email is required for add command");
      process.exit(1);
    }
    addAdminUser(email);
    break;
  case "remove":
    if (!email) {
      console.error("❌ Email is required for remove command");
      process.exit(1);
    }
    removeAdminUser(email);
    break;
  case "list":
    listAdminUsers();
    break;
  default:
    console.error(`❌ Unknown command: ${command}`);
    process.exit(1);
}
