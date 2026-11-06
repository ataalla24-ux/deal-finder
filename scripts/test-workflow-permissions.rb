require 'yaml'

def reject_duplicate_keys(node, file)
  if node.is_a?(Psych::Nodes::Mapping)
    seen = {}
    node.children.each_slice(2) do |key, _value|
      next unless key.is_a?(Psych::Nodes::Scalar)
      raise "#{file}:#{key.start_line + 1}: duplicate YAML key #{key.value}" if seen[key.value]
      seen[key.value] = true
    end
  end
  node.children&.each { |child| reject_duplicate_keys(child, file) }
end

begin
  reject_duplicate_keys(Psych.parse("env:\n  GH_TOKEN: first\n  GH_TOKEN: second\n"), 'duplicate-fixture')
  raise 'Duplicate YAML fixture was incorrectly accepted'
rescue RuntimeError => error
  raise unless error.message.include?('duplicate YAML key GH_TOKEN')
end

files = Dir[File.expand_path('../.github/workflows/*.{yml,yaml}', __dir__)]
jobs = 0
files.each do |file|
  reject_duplicate_keys(Psych.parse_file(file), File.basename(file))
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
puts "Workflow permission checks passed: #{files.length} workflows, #{jobs} jobs, no duplicate YAML keys, implicit permissions or unreviewed privileged PR triggers."
