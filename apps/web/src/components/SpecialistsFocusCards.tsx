import React, { useState } from "react";
import { FocusCards } from "@/components/ui/focus-cards";
import {
  IconCode,
  IconBrush,
  IconTestPipe,
  IconBook,
  IconRobot,
} from "@tabler/icons-react";

export function SpecialistsFocusCards() {
  const cards = [
    {
      title: "Frontend Specialist",
      src: "https://images.unsplash.com/photo-1633356122544-f134324a6cee?q=80&w=2070",
      description: "Handles UI/UX implementation, React components, and user interactions",
      icon: <IconBrush className="h-6 w-6 text-blue-500" />,
      stats: {
        tasksCompleted: 42,
        successRate: 95,
        avgTime: "2.3h",
        specialties: ["React", "TypeScript", "Tailwind", "Framer Motion"],
      },
    },
    {
      title: "Backend Specialist",
      src: "https://images.unsplash.com/photo-1558494949-ef010cbdcc31?q=80&w=2071",
      description: "Manages API endpoints, database operations, and server-side logic",
      icon: <IconCode className="h-6 w-6 text-green-500" />,
      stats: {
        tasksCompleted: 38,
        successRate: 92,
        avgTime: "3.1h",
        specialties: ["Node.js", "PostgreSQL", "Redis", "REST APIs"],
      },
    },
    {
      title: "Testing Specialist",
      src: "https://images.unsplash.com/photo-1555949963-ff9fe0c870eb?q=80&w=2070",
      description: "Creates comprehensive test suites and ensures code quality",
      icon: <IconTestPipe className="h-6 w-6 text-purple-500" />,
      stats: {
        tasksCompleted: 27,
        successRate: 98,
        avgTime: "1.8h",
        specialties: ["Jest", "Cypress", "Unit Testing", "E2E Testing"],
      },
    },
    {
      title: "Documentation Specialist",
      src: "https://images.unsplash.com/photo-1481627834876-b7833e8f5570?q=80&w=1928",
      description: "Maintains clear documentation and API references",
      icon: <IconBook className="h-6 w-6 text-orange-500" />,
      stats: {
        tasksCompleted: 31,
        successRate: 100,
        avgTime: "1.5h",
        specialties: ["Technical Writing", "API Docs", "Markdown", "Diagrams"],
      },
    },
    {
      title: "General Specialist",
      src: "https://images.unsplash.com/photo-1485827404703-89b55fcc595e?q=80&w=2070",
      description: "Versatile specialist handling diverse tasks across domains",
      icon: <IconRobot className="h-6 w-6 text-gray-500" />,
      stats: {
        tasksCompleted: 56,
        successRate: 90,
        avgTime: "2.7h",
        specialties: ["Problem Solving", "Integration", "Debugging", "Optimization"],
      },
    },
  ];

  const focusCards = cards.map((card) => ({
    title: card.title,
    src: card.src,
    content: (
      <div className="p-4">
        <div className="flex items-start gap-3 mb-4">
          {card.icon}
          <div>
            <h3 className="font-semibold text-lg text-neutral-800 dark:text-neutral-200">
              {card.title}
            </h3>
            <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1">
              {card.description}
            </p>
          </div>
        </div>
        
        <div className="grid grid-cols-2 gap-4 mt-6">
          <div className="bg-neutral-100 dark:bg-neutral-800 rounded-lg p-3">
            <div className="text-2xl font-bold text-neutral-800 dark:text-neutral-200">
              {card.stats.tasksCompleted}
            </div>
            <div className="text-xs text-neutral-600 dark:text-neutral-400">
              Tasks Completed
            </div>
          </div>
          <div className="bg-neutral-100 dark:bg-neutral-800 rounded-lg p-3">
            <div className="text-2xl font-bold text-green-600 dark:text-green-400">
              {card.stats.successRate}%
            </div>
            <div className="text-xs text-neutral-600 dark:text-neutral-400">
              Success Rate
            </div>
          </div>
          <div className="bg-neutral-100 dark:bg-neutral-800 rounded-lg p-3">
            <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
              {card.stats.avgTime}
            </div>
            <div className="text-xs text-neutral-600 dark:text-neutral-400">
              Avg. Time
            </div>
          </div>
          <div className="bg-neutral-100 dark:bg-neutral-800 rounded-lg p-3">
            <div className="text-xs font-semibold text-neutral-800 dark:text-neutral-200">
              Specialties
            </div>
            <div className="text-xs text-neutral-600 dark:text-neutral-400 mt-1">
              {card.stats.specialties.length} skills
            </div>
          </div>
        </div>

        <div className="mt-4">
          <div className="text-xs font-semibold text-neutral-600 dark:text-neutral-400 mb-2">
            Core Skills:
          </div>
          <div className="flex flex-wrap gap-1">
            {card.stats.specialties.map((skill, idx) => (
              <span
                key={idx}
                className="px-2 py-1 text-xs bg-neutral-200 dark:bg-neutral-700 rounded-full text-neutral-700 dark:text-neutral-300"
              >
                {skill}
              </span>
            ))}
          </div>
        </div>
      </div>
    ),
  }));

  return (
    <div className="w-full">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-neutral-800 dark:text-neutral-200 mb-2">
          Swarm Specialists
        </h2>
        <p className="text-neutral-600 dark:text-neutral-400">
          Hover over each specialist to focus on their capabilities and performance metrics.
          These AI specialists work in parallel to decompose and solve complex tasks.
        </p>
      </div>
      <FocusCards cards={focusCards} />
    </div>
  );
}