require 'yaml'

files = Dir[File.expand_path('../.github/workflows/*.{yml,yaml}', __dir__)]
jobs = 0
files.each do |file|
  workflow = YAML.load_file(file)
  # YAML 1.1 treats the GitHub key "on" as true.
  triggers = workflow['on'] || workflow[true]
  if triggers.is_a?(Hash) && triggers.key?('pull_request_target')
    raise "#{File.basename(file)}: privileged pull_request_target requires separate review"
  end
  workflow.fetch('jobs', {}).each do |name, job|
    jobs += 1
    permissions = job.fetch('permissions', workflow['permissions'])
    unless permissions.is_a?(Hash) && %w[read write none].include?(permissions['contents'])
      raise "#{File.basename(file)}/#{name}: declare explicit contents permissions"
    end
    writes = job.fetch('steps', []).any? do |step|
      step.fetch('run', '').match?(/commit-generated\.mjs|\bgit\s+push\b/)
    end
    if writes && permissions['contents'] != 'write'
      raise "#{File.basename(file)}/#{name}: generated-state writer lost contents: write"
    end
  end
end
raise 'No workflow jobs found' if jobs.zero?
puts "Workflow permission checks passed: #{files.length} workflows, #{jobs} jobs, no implicit permissions or unreviewed privileged PR triggers."
