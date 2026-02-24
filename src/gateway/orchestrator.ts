import { randomUUID } from 'crypto';

import { ManagerAgent } from '../agents/manager';
import { ExecutorAgent } from '../agents/executor';
import { VerifierAgent } from '../agents/verifier';
import { getDatabase } from '../db/database';
import { getToolRegistry } from '../tools/registry';
import { getConfig } from '../config/config';
import { Job, Task, TaskState, JobStatus, TaskStatus } from '../types';

export class AgentOrchestrator {
  private manager = new ManagerAgent();
  private executor = new ExecutorAgent();
  private verifier = new VerifierAgent();
  private db = getDatabase();
  private tools = getToolRegistry();
  private config = getConfig().getConfig();

  async executeJob(mission: string, options?: { priority?: number }): Promise<string> {
    // Create job
    const jobId = randomUUID();
    const job: Job = {
      id: jobId,
      title: mission.slice(0, 100),
      description: mission,
      status: 'planning',
      priority: options?.priority || 0,
      created_at: Date.now(),
      updated_at: Date.now()
    };

    this.db.createJob(job);

    // Initialize task state
    const state: TaskState = {
      job_id: jobId,
      mission,
      constraints: [],
      plan: [],
      current_task: null,
      completed_tasks: [],
      pending_tasks: [],
      open_questions: [],
      risks: [],
      artifacts: [],
      steps: []
    };

    this.db.saveTaskState(state);

    // Start execution in background
    this.runJobAsync(jobId, mission, state).catch(error => {
      console.error(`Job ${jobId} failed:`, error);
      this.db.updateJobStatus(jobId, 'failed');
    });

    return jobId;
  }

  private async runJobAsync(jobId: string, mission: string, state: TaskState): Promise<void> {
    try {
      // Phase 1: Planning
      console.log(`[${jobId}] Planning phase...`);
      this.db.updateJobStatus(jobId, 'planning');
      
      const plan = await this.manager.plan(mission, state);
      
      // Check if approval needed
      if (plan.requires_approval) {
        this.db.updateJobStatus(jobId, 'needs_approval');
        const approval = this.db.createApproval({
          id: randomUUID(),
          job_id: jobId,
          task_id: 'planning',
          action: 'execute_plan',
          reason: 'Plan requires human approval',
          details: { plan },
          status: 'pending'
        });
        console.log(`[${jobId}] Waiting for approval: ${approval.id}`);
        return; // Wait for human approval
      }

      // Create tasks
      for (const taskPlan of plan.plan) {
        const task: Omit<Task, 'created_at'> = {
          id: taskPlan.id,
          job_id: jobId,
          title: taskPlan.title,
          description: taskPlan.description,
          status: 'pending',
          assigned_to: taskPlan.assigned_to,
          dependencies: taskPlan.dependencies,
          acceptance_criteria: taskPlan.acceptance_criteria,
          retry_count: 0,
          started_at: undefined,
          completed_at: undefined
        };
        
        this.db.createTask(task);
        state.pending_tasks.push(task.id);
      }

      state.plan = this.db.listTasksForJob(jobId);
      state.risks = plan.risks;
      this.db.saveTaskState(state);

      // Phase 2: Execution
      console.log(`[${jobId}] Execution phase... ${state.plan.length} tasks`);
      this.db.updateJobStatus(jobId, 'executing');

      for (const task of state.plan) {
        await this.executeTask(jobId, task, state);
      }

      // Phase 3: Completion
      console.log(`[${jobId}] Job completed!`);
      this.db.updateJobStatus(jobId, 'completed');

    } catch (error: any) {
      console.error(`[${jobId}] Error:`, error);
      this.db.updateJobStatus(jobId, 'failed');
      throw error;
    }
  }

  private async executeTask(jobId: string, task: Task, state: TaskState): Promise<void> {
    console.log(`[${jobId}] Executing task: ${task.title}`);
    
    this.db.updateTaskStatus(task.id, 'in_progress');
    state.current_task = task.id;
    this.db.saveTaskState(state);

    const maxSteps = 10;
    let stepCount = 0;
    const taskSteps: Array<{ action: any; result: any }> = [];

    while (stepCount < maxSteps) {
      stepCount++;
      console.log(`[${jobId}] Task ${task.id} - Step ${stepCount}`);

      // Executor generates next action
      const executorOutput = await this.executor.step(task, state, taskSteps);

      // Check if task is complete
      if (executorOutput.response) {
        console.log(`[${jobId}] Task ${task.id} claims completion`);
        
        // Verify completion
        const verification = await this.verifier.verifyCompletion(task, taskSteps);
        
        if (verification.status === 'approved') {
          console.log(`[${jobId}] Task ${task.id} approved!`);
          this.db.updateTaskStatus(task.id, 'completed');
          state.completed_tasks.push(task.id);
          state.pending_tasks = state.pending_tasks.filter(id => id !== task.id);
          state.current_task = null;
          
          // Save artifacts if any
          if (executorOutput.artifacts) {
            for (const artifactPath of executorOutput.artifacts) {
              this.db.createArtifact({
                id: randomUUID(),
                job_id: jobId,
                task_id: task.id,
                type: 'file',
                path: artifactPath,
                content: executorOutput.response
              });
            }
          }
          
          this.db.saveTaskState(state);
          return;
        } else if (verification.status === 'rejected') {
          console.log(`[${jobId}] Task ${task.id} rejected: ${verification.issues?.join(', ')}`);
          // Retry with feedback
          state.feedback = verification.issues;
          this.db.saveTaskState(state);
          continue;
        } else {
          // needs_approval
          console.log(`[${jobId}] Task ${task.id} needs approval`);
          this.db.updateJobStatus(jobId, 'needs_approval');
          this.db.createApproval({
            id: randomUUID(),
            job_id: jobId,
            task_id: task.id,
            action: 'complete_task',
            reason: verification.approval_reason,
            status: 'pending'
          });
          return;
        }
      }

      // Execute tool
      if (executorOutput.tool) {
        console.log(`[${jobId}] Executing tool: ${executorOutput.tool}`);
        
        const toolResult = await this.tools.execute(
          executorOutput.tool,
          executorOutput.args
        );

        console.log(`[${jobId}] Tool result: ${toolResult.success ? 'success' : 'failed'}`);

        // Save step
        this.db.createStep({
          id: randomUUID(),
          task_id: task.id,
          step_number: stepCount,
          agent_role: 'executor',
          tool_name: executorOutput.tool,
          tool_args: executorOutput.args,
          result: toolResult,
          error: toolResult.success ? undefined : toolResult.error
        });

        // Add to task steps
        taskSteps.push({
          action: executorOutput,
          result: toolResult
        });

        state.steps = taskSteps;
        this.db.saveTaskState(state);

        // Verify step
        const verification = await this.verifier.verify(task, state, executorOutput, toolResult);

        if (verification.status === 'rejected') {
          console.log(`[${jobId}] Step rejected: ${verification.issues?.join(', ')}`);
          state.feedback = verification.issues;
          this.db.saveTaskState(state);
        } else if (verification.status === 'needs_approval') {
          console.log(`[${jobId}] Step needs approval`);
          this.db.updateJobStatus(jobId, 'needs_approval');
          this.db.createApproval({
            id: randomUUID(),
            job_id: jobId,
            task_id: task.id,
            action: executorOutput.tool || 'unknown',
            reason: verification.approval_reason,
            details: { tool: executorOutput.tool, args: executorOutput.args },
            status: 'pending'
          });
          return;
        }
      }
    }

    // Max steps reached
    console.log(`[${jobId}] Task ${task.id} reached max steps`);
    this.db.updateTaskStatus(task.id, 'failed');
    state.current_task = null;
    this.db.saveTaskState(state);
  }

  getJobStatus(jobId: string): Job | null {
    return this.db.getJob(jobId);
  }

  listJobs(status?: JobStatus): Job[] {
    return this.db.listJobs(status);
  }

  getJobTasks(jobId: string): Task[] {
    return this.db.listTasksForJob(jobId);
  }

  getJobArtifacts(jobId: string): any[] {
    return this.db.listArtifactsForJob(jobId);
  }

  getPendingApprovals(): any[] {
    return this.db.listPendingApprovals();
  }

  approveAction(approvalId: string): void {
    this.db.resolveApproval(approvalId, 'approved');
    // TODO: Resume job execution
  }

  rejectAction(approvalId: string): void {
    this.db.resolveApproval(approvalId, 'rejected');
    // TODO: Handle rejection
  }
}
