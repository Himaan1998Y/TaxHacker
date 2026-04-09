import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.mock calls are hoisted above imports, so any referenced values must
// be hoisted too via vi.hoisted(). This lets the test cases still inspect
// and control the mocks from the closure.
const {
  findFirstProject,
  findFirstCategory,
  createProjectMock,
  createCategoryMock,
} = vi.hoisted(() => ({
  findFirstProject: vi.fn(),
  findFirstCategory: vi.fn(),
  createProjectMock: vi.fn(),
  createCategoryMock: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    project: { findFirst: findFirstProject },
    category: { findFirst: findFirstCategory },
  },
}))

vi.mock('@/models/projects', () => ({
  createProject: (...args: unknown[]) => createProjectMock(...args),
  getProjectByCode: vi.fn(),
}))

vi.mock('@/models/categories', () => ({
  createCategory: (...args: unknown[]) => createCategoryMock(...args),
  getCategoryByCode: vi.fn(),
}))

import { importProject, importCategory } from '@/models/export_and_import'

describe('importProject / importCategory tenant isolation', () => {
  beforeEach(() => {
    findFirstProject.mockReset()
    findFirstCategory.mockReset()
    createProjectMock.mockReset()
    createCategoryMock.mockReset()
  })

  it('scopes the project lookup to the calling userId', async () => {
    findFirstProject.mockResolvedValue(null)
    createProjectMock.mockResolvedValue({ id: 'p1', userId: 'user-A', code: 'sales', name: 'Sales' })

    await importProject('user-A', 'Sales')

    expect(findFirstProject).toHaveBeenCalledTimes(1)
    const whereArg = findFirstProject.mock.calls[0][0].where
    expect(whereArg.userId).toBe('user-A')
    expect(whereArg.OR).toEqual([{ code: 'sales' }, { name: 'Sales' }])
  })

  it('does not return another user’s project with the same name', async () => {
    // Prisma, with the userId filter in place, must return null for user-B
    // even if user-A already owns a row with the same name. Simulate that
    // by having findFirst honour the filter: return null when called with
    // userId=user-B, the existing row when called with userId=user-A.
    findFirstProject.mockImplementation(async ({ where }) => {
      if (where.userId === 'user-A') {
        return { id: 'p-of-A', userId: 'user-A', code: 'sales', name: 'Sales' }
      }
      return null
    })
    createProjectMock.mockImplementation(async (userId: string, data) => ({
      id: `new-${userId}`,
      userId,
      ...data,
    }))

    const resultForA = await importProject('user-A', 'Sales')
    const resultForB = await importProject('user-B', 'Sales')

    expect(resultForA.id).toBe('p-of-A')
    expect(resultForA.userId).toBe('user-A')
    // user-B must get a freshly created project scoped to user-B, not A's row.
    expect(resultForB.id).toBe('new-user-B')
    expect(resultForB.userId).toBe('user-B')
    expect(createProjectMock).toHaveBeenCalledWith('user-B', { code: 'sales', name: 'Sales' })
  })

  it('scopes the category lookup to the calling userId', async () => {
    findFirstCategory.mockResolvedValue(null)
    createCategoryMock.mockResolvedValue({ id: 'c1', userId: 'user-A', code: 'office', name: 'Office' })

    await importCategory('user-A', 'Office')

    expect(findFirstCategory).toHaveBeenCalledTimes(1)
    const whereArg = findFirstCategory.mock.calls[0][0].where
    expect(whereArg.userId).toBe('user-A')
    expect(whereArg.OR).toEqual([{ code: 'office' }, { name: 'Office' }])
  })

  it('does not return another user’s category with the same name', async () => {
    findFirstCategory.mockImplementation(async ({ where }) => {
      if (where.userId === 'user-A') {
        return { id: 'c-of-A', userId: 'user-A', code: 'office', name: 'Office' }
      }
      return null
    })
    createCategoryMock.mockImplementation(async (userId: string, data) => ({
      id: `new-${userId}`,
      userId,
      ...data,
    }))

    const resultForA = await importCategory('user-A', 'Office')
    const resultForB = await importCategory('user-B', 'Office')

    expect(resultForA.id).toBe('c-of-A')
    expect(resultForA.userId).toBe('user-A')
    expect(resultForB.id).toBe('new-user-B')
    expect(resultForB.userId).toBe('user-B')
    expect(createCategoryMock).toHaveBeenCalledWith('user-B', { code: 'office', name: 'Office' })
  })
})
