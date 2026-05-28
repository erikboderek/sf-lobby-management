// Assign the FSL and Scheduler permission sets to the running user.
// Execute this once after deploying to a scratch org or sandbox.
// SFDX: Execute Anonymous Apex with Editor Contents

Id userId = UserInfo.getUserId();
List<PermissionSet> psets = [
    SELECT Id, Name FROM PermissionSet
    WHERE Name IN ('FSL_Agent_Permissions', 'FSL_Dispatcher_Permissions', 'LightningSchedulerStandardUser')
];
List<PermissionSetAssignment> assignments = new List<PermissionSetAssignment>();
for (PermissionSet ps : psets) {
    assignments.add(new PermissionSetAssignment(AssigneeId = userId, PermissionSetId = ps.Id));
}
insert assignments;
System.debug('Assigned ' + assignments.size() + ' permission sets to ' + UserInfo.getName());
