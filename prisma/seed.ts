import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Starting database seeding...");

  // Clear existing data
  await prisma.staff.deleteMany();
  await prisma.department.deleteMany();
  await prisma.organ.deleteMany();
  await prisma.jobTitle.deleteMany();
  await prisma.user.deleteMany();
  await prisma.role.deleteMany();
  await prisma.permission.deleteMany();

  console.log("🗑️  Cleared existing data");

  // Create Permissions
  const permissions = await Promise.all([
    prisma.permission.create({
      data: {
        action: "read",
        entity: "staff",
        access: "all",
        description: "Read all staff information",
      },
    }),
    prisma.permission.create({
      data: {
        action: "write",
        entity: "staff",
        access: "own",
        description: "Write own staff information",
      },
    }),
    prisma.permission.create({
      data: {
        action: "delete",
        entity: "staff",
        access: "all",
        description: "Delete staff records",
      },
    }),
    prisma.permission.create({
      data: {
        action: "read",
        entity: "department",
        access: "all",
        description: "Read department information",
      },
    }),
    prisma.permission.create({
      data: {
        action: "write",
        entity: "department",
        access: "all",
        description: "Write department information",
      },
    }),
    prisma.permission.create({
      data: {
        action: "read",
        entity: "organ",
        access: "all",
        description: "Read organization information",
      },
    }),
    prisma.permission.create({
      data: {
        action: "write",
        entity: "organ",
        access: "all",
        description: "Write organization information",
      },
    }),
    prisma.permission.create({
      data: {
        action: "manage",
        entity: "users",
        access: "all",
        description: "Manage all users",
      },
    }),
    prisma.permission.create({
      data: {
        action: "manage",
        entity: "roles",
        access: "all",
        description: "Manage roles and permissions",
      },
    }),
  ]);

  console.log("✅ Created permissions");

  // Create Roles
  const adminRole = await prisma.role.create({
    data: {
      name: "Administrator",
      description: "Full system access",
      permissions: {
        connect: permissions.map((p) => ({ id: p.id })),
      },
    },
  });

  const managerRole = await prisma.role.create({
    data: {
      name: "Manager",
      description: "Department management access",
      permissions: {
        connect: [
          { id: permissions[0].id }, // read staff all
          { id: permissions[1].id }, // write staff own
          { id: permissions[3].id }, // read department all
          { id: permissions[4].id }, // write department all
        ],
      },
    },
  });

  const staffRole = await prisma.role.create({
    data: {
      name: "Staff",
      description: "Basic staff access",
      permissions: {
        connect: [
          { id: permissions[0].id }, // read staff all
          { id: permissions[1].id }, // write staff own
        ],
      },
    },
  });

  console.log("✅ Created roles");

  // Create Users
  const adminUser = await prisma.user.create({
    data: {
      email: "admin@greenbook.com",
      name: "System Administrator",
      role: "admin",
      roles: {
        connect: [{ id: adminRole.id }],
      },
    },
  });

  const managerUser = await prisma.user.create({
    data: {
      email: "manager@greenbook.com",
      name: "Department Manager",
      role: "manager",
      roles: {
        connect: [{ id: managerRole.id }],
      },
    },
  });

  const staffUser = await prisma.user.create({
    data: {
      email: "staff@greenbook.com",
      name: "Regular Staff",
      role: "staff",
      roles: {
        connect: [{ id: staffRole.id }],
      },
    },
  });

  console.log("✅ Created users");

  // Create Organizations
  const organizations = await Promise.all([
    prisma.organ.create({
      data: {
        name: "GreenBook Technologies",
        description: "Leading technology solutions provider",
      },
    }),
    prisma.organ.create({
      data: {
        name: "GreenBook Consulting",
        description: "Strategic business consulting services",
      },
    }),
  ]);

  console.log("✅ Created organizations");

  // Create Job Titles
  const jobTitles = await Promise.all([
    prisma.jobTitle.create({ data: { title: "Chief Executive Officer" } }),
    prisma.jobTitle.create({ data: { title: "Chief Technology Officer" } }),
    prisma.jobTitle.create({ data: { title: "Chief Financial Officer" } }),
    prisma.jobTitle.create({ data: { title: "Director of Operations" } }),
    prisma.jobTitle.create({ data: { title: "Senior Manager" } }),
    prisma.jobTitle.create({ data: { title: "Project Manager" } }),
    prisma.jobTitle.create({ data: { title: "Senior Developer" } }),
    prisma.jobTitle.create({ data: { title: "Software Engineer" } }),
    prisma.jobTitle.create({ data: { title: "UI/UX Designer" } }),
    prisma.jobTitle.create({ data: { title: "Data Analyst" } }),
    prisma.jobTitle.create({ data: { title: "Marketing Specialist" } }),
    prisma.jobTitle.create({ data: { title: "Human Resources Manager" } }),
    prisma.jobTitle.create({ data: { title: "Administrative Assistant" } }),
  ]);

  console.log("✅ Created job titles");

  // Create Departments
  const departments = await Promise.all([
    prisma.department.create({
      data: {
        name: "Executive Office",
        organId: organizations[0].id,
      },
    }),
    prisma.department.create({
      data: {
        name: "Technology",
        organId: organizations[0].id,
      },
    }),
    prisma.department.create({
      data: {
        name: "Finance",
        organId: organizations[0].id,
      },
    }),
    prisma.department.create({
      data: {
        name: "Operations",
        organId: organizations[0].id,
      },
    }),
    prisma.department.create({
      data: {
        name: "Marketing",
        organId: organizations[0].id,
      },
    }),
    prisma.department.create({
      data: {
        name: "Human Resources",
        organId: organizations[0].id,
      },
    }),
    prisma.department.create({
      data: {
        name: "Consulting Services",
        organId: organizations[1].id,
      },
    }),
  ]);

  console.log("✅ Created departments");

  // Create Staff Members
  const staffMembers = await Promise.all([
    // CEO
    prisma.staff.create({
      data: {
        fullName: "Sarah Johnson",
        email: "sarah.johnson@greenbook.com",
        phone: "+1-555-0101",
        photoUrl:
          "https://images.unsplash.com/photo-1494790108755-2616b612b786?w=150&h=150&fit=crop&crop=face",
        jobTitleId: jobTitles[0].id, // CEO
        departmentId: departments[0].id, // Executive Office
        employmentType: "Full-time",
        expertise: ["Strategic Planning", "Leadership", "Business Development"],
        biography:
          "Sarah has over 15 years of experience in technology leadership and business strategy.",
        officeLocation: "Floor 10, Suite 1001",
        bioEn:
          "Sarah Johnson is the Chief Executive Officer of GreenBook Technologies, leading the company's strategic vision and growth initiatives.",
        bioFr:
          "Sarah Johnson est la directrice générale de GreenBook Technologies, dirigeant la vision stratégique et les initiatives de croissance de l'entreprise.",
        bioAr:
          "سارة جونسون هي الرئيس التنفيذي لشركة GreenBook Technologies، وتقود الرؤية الاستراتيجية ومبادرات النمو للشركة.",
        bioPt:
          "Sarah Johnson é a CEO da GreenBook Technologies, liderando a visão estratégica e iniciativas de crescimento da empresa.",
      },
    }),
    // CTO
    prisma.staff.create({
      data: {
        fullName: "Michael Chen",
        email: "michael.chen@greenbook.com",
        phone: "+1-555-0102",
        photoUrl:
          "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150&h=150&fit=crop&crop=face",
        jobTitleId: jobTitles[1].id, // CTO
        departmentId: departments[1].id, // Technology
        reportsToId: (
          await prisma.staff.findFirst({
            where: { email: "sarah.johnson@greenbook.com" },
          })
        )?.id,
        employmentType: "Full-time",
        expertise: ["Software Architecture", "Cloud Computing", "AI/ML"],
        biography:
          "Michael is a technology visionary with expertise in scalable software systems.",
        officeLocation: "Floor 8, Suite 801",
        bioEn:
          "Michael Chen serves as the Chief Technology Officer, driving innovation and technical excellence across all products.",
        bioFr:
          "Michael Chen occupe le poste de directeur technique, stimulant l'innovation et l'excellence technique dans tous les produits.",
        bioAr:
          "يشغل مايكل تشين منصب المدير التقني، ويقود الابتكار والتميز التقني في جميع المنتجات.",
        bioPt:
          "Michael Chen atua como CTO, impulsionando a inovação e excelência técnica em todos os produtos.",
      },
    }),
    // CFO
    prisma.staff.create({
      data: {
        fullName: "Emily Rodriguez",
        email: "emily.rodriguez@greenbook.com",
        phone: "+1-555-0103",
        photoUrl:
          "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=150&h=150&fit=crop&crop=face",
        jobTitleId: jobTitles[2].id, // CFO
        departmentId: departments[2].id, // Finance
        reportsToId: (
          await prisma.staff.findFirst({
            where: { email: "sarah.johnson@greenbook.com" },
          })
        )?.id,
        employmentType: "Full-time",
        expertise: [
          "Financial Planning",
          "Risk Management",
          "Mergers & Acquisitions",
        ],
        biography:
          "Emily brings 12 years of financial leadership experience in technology companies.",
        officeLocation: "Floor 9, Suite 901",
        bioEn:
          "Emily Rodriguez is the Chief Financial Officer, overseeing all financial operations and strategic planning.",
        bioFr:
          "Emily Rodriguez est la directrice financière, supervisant toutes les opérations financières et la planification stratégique.",
        bioAr:
          "إيميلي رودريغيز هي المديرة المالية، وتشرف على جميع العمليات المالية والتخطيط الاستراتيجي.",
        bioPt:
          "Emily Rodriguez é a CFO, supervisionando todas as operações financeiras e planejamento estratégico.",
      },
    }),
    // Senior Developer
    prisma.staff.create({
      data: {
        fullName: "David Kim",
        email: "david.kim@greenbook.com",
        phone: "+1-555-0104",
        photoUrl:
          "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&h=150&fit=crop&crop=face",
        jobTitleId: jobTitles[6].id, // Senior Developer
        departmentId: departments[1].id, // Technology
        reportsToId: (
          await prisma.staff.findFirst({
            where: { email: "michael.chen@greenbook.com" },
          })
        )?.id,
        employmentType: "Full-time",
        expertise: ["React", "Node.js", "TypeScript", "Database Design"],
        biography:
          "David is a passionate developer with 8 years of experience in full-stack development.",
        officeLocation: "Floor 7, Suite 701",
        bioEn:
          "David Kim is a Senior Developer specializing in modern web technologies and scalable applications.",
        bioFr:
          "David Kim est un développeur senior spécialisé dans les technologies web modernes et les applications évolutives.",
        bioAr:
          "ديفيد كيم هو مطور كبير متخصص في تقنيات الويب الحديثة والتطبيقات القابلة للتطوير.",
        bioPt:
          "David Kim é um Desenvolvedor Sênior especializado em tecnologias web modernas e aplicações escaláveis.",
      },
    }),
    // UI/UX Designer
    prisma.staff.create({
      data: {
        fullName: "Lisa Wang",
        email: "lisa.wang@greenbook.com",
        phone: "+1-555-0105",
        photoUrl:
          "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&h=150&fit=crop&crop=face",
        jobTitleId: jobTitles[8].id, // UI/UX Designer
        departmentId: departments[1].id, // Technology
        reportsToId: (
          await prisma.staff.findFirst({
            where: { email: "michael.chen@greenbook.com" },
          })
        )?.id,
        employmentType: "Full-time",
        expertise: [
          "User Research",
          "Prototyping",
          "Design Systems",
          "Accessibility",
        ],
        biography:
          "Lisa creates intuitive and beautiful user experiences that delight customers.",
        officeLocation: "Floor 7, Suite 702",
        bioEn:
          "Lisa Wang is a UI/UX Designer focused on creating user-centered design solutions.",
        bioFr:
          "Lisa Wang est une designer UI/UX axée sur la création de solutions de design centrées sur l'utilisateur.",
        bioAr:
          "ليزا وانغ هي مصممة واجهات المستخدم تركز على إنشاء حلول تصميم تركز على المستخدم.",
        bioPt:
          "Lisa Wang é uma Designer UI/UX focada em criar soluções de design centradas no usuário.",
      },
    }),
    // Marketing Specialist
    prisma.staff.create({
      data: {
        fullName: "Alex Thompson",
        email: "alex.thompson@greenbook.com",
        phone: "+1-555-0106",
        photoUrl:
          "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&h=150&fit=crop&crop=face",
        jobTitleId: jobTitles[10].id, // Marketing Specialist
        departmentId: departments[4].id, // Marketing
        employmentType: "Full-time",
        expertise: [
          "Digital Marketing",
          "Content Strategy",
          "Social Media",
          "Analytics",
        ],
        biography:
          "Alex drives brand awareness and customer engagement through innovative marketing campaigns.",
        officeLocation: "Floor 6, Suite 601",
        bioEn:
          "Alex Thompson is a Marketing Specialist driving brand growth through digital and traditional channels.",
        bioFr:
          "Alex Thompson est un spécialiste du marketing qui stimule la croissance de la marque par des canaux numériques et traditionnels.",
        bioAr:
          "أليكس طومسون هو متخصص في التسويق يقود نمو العلامة التجارية من خلال القنوات الرقمية والتقليدية.",
        bioPt:
          "Alex Thompson é um Especialista em Marketing impulsionando o crescimento da marca através de canais digitais e tradicionais.",
      },
    }),
    // HR Manager
    prisma.staff.create({
      data: {
        fullName: "Maria Garcia",
        email: "maria.garcia@greenbook.com",
        phone: "+1-555-0107",
        photoUrl:
          "https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?w=150&h=150&fit=crop&crop=face",
        jobTitleId: jobTitles[11].id, // HR Manager
        departmentId: departments[5].id, // Human Resources
        employmentType: "Full-time",
        expertise: [
          "Talent Acquisition",
          "Employee Relations",
          "Performance Management",
          "HR Strategy",
        ],
        biography:
          "Maria ensures our team thrives with comprehensive HR support and development programs.",
        officeLocation: "Floor 5, Suite 501",
        bioEn:
          "Maria Garcia is the Human Resources Manager, fostering a positive workplace culture and employee development.",
        bioFr:
          "Maria Garcia est la responsable des ressources humaines, favorisant une culture de travail positive et le développement des employés.",
        bioAr:
          "ماريا غارسيا هي مديرة الموارد البشرية، وتعزز ثقافة العمل الإيجابية وتطوير الموظفين.",
        bioPt:
          "Maria Garcia é a Gerente de Recursos Humanos, promovendo uma cultura de trabalho positiva e desenvolvimento de funcionários.",
      },
    }),
  ]);

  console.log("✅ Created staff members");

  // Create additional staff for the consulting organization
  const consultingStaff = await Promise.all([
    prisma.staff.create({
      data: {
        fullName: "James Wilson",
        email: "james.wilson@greenbook.com",
        phone: "+1-555-0201",
        photoUrl:
          "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=150&h=150&fit=crop&crop=face",
        jobTitleId: jobTitles[3].id, // Director of Operations
        departmentId: departments[6].id, // Consulting Services
        employmentType: "Full-time",
        expertise: [
          "Business Strategy",
          "Process Optimization",
          "Change Management",
        ],
        biography:
          "James leads our consulting practice with deep expertise in business transformation.",
        officeLocation: "Consulting Office, Floor 3",
        bioEn:
          "James Wilson is the Director of Operations for our consulting division, leading strategic business initiatives.",
        bioFr:
          "James Wilson est le directeur des opérations de notre division de conseil, dirigeant les initiatives stratégiques commerciales.",
        bioAr:
          "جيمس ويلسون هو مدير العمليات لقسم الاستشارات لدينا، ويقود المبادرات الاستراتيجية للأعمال.",
        bioPt:
          "James Wilson é o Diretor de Operações da nossa divisão de consultoria, liderando iniciativas estratégicas de negócios.",
      },
    }),
    prisma.staff.create({
      data: {
        fullName: "Sophie Martin",
        email: "sophie.martin@greenbook.com",
        phone: "+1-555-0202",
        photoUrl:
          "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&h=150&fit=crop&crop=face",
        jobTitleId: jobTitles[5].id, // Project Manager
        departmentId: departments[6].id, // Consulting Services
        reportsToId: (
          await prisma.staff.findFirst({
            where: { email: "james.wilson@greenbook.com" },
          })
        )?.id,
        employmentType: "Full-time",
        expertise: [
          "Project Management",
          "Client Relations",
          "Agile Methodologies",
        ],
        biography:
          "Sophie ensures successful delivery of consulting projects with exceptional client satisfaction.",
        officeLocation: "Consulting Office, Floor 3",
        bioEn:
          "Sophie Martin is a Project Manager specializing in delivering complex consulting engagements.",
        bioFr:
          "Sophie Martin est une chef de projet spécialisée dans la livraison d'engagements de conseil complexes.",
        bioAr:
          "صوفي مارتن هي مديرة مشاريع متخصصة في تقديم مشاريع استشارية معقدة.",
        bioPt:
          "Sophie Martin é uma Gerente de Projetos especializada em entregar projetos de consultoria complexos.",
      },
    }),
  ]);

  console.log("✅ Created consulting staff");

  console.log("🎉 Database seeding completed successfully!");
  console.log(`📊 Created ${permissions.length} permissions`);
  console.log(`👥 Created 3 roles`);
  console.log(`👤 Created 3 users`);
  console.log(`🏢 Created ${organizations.length} organizations`);
  console.log(`📋 Created ${jobTitles.length} job titles`);
  console.log(`🏛️  Created ${departments.length} departments`);
  console.log(
    `👨‍💼 Created ${staffMembers.length + consultingStaff.length} staff members`
  );
}

main()
  .catch((e) => {
    console.error("❌ Error during seeding:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
